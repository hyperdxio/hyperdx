import { useRouter } from 'next/router';
import * as chrono from 'chrono-node';
import {
  useQueryParam,
  StringParam,
  withDefault,
  NumberParam,
  useQueryParams,
} from 'use-query-params';
import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { format, sub, startOfSecond } from 'date-fns';
import { formatInTimeZone } from 'date-fns-tz';
import { usePrevious } from './utils';

const LIVE_TAIL_TIME_QUERY = 'Live Tail';
const LIVE_TAIL_REFRESH_INTERVAL_MS = 4000;

const formatDate = (
  date: Date,
  isUTC: boolean,
  strFormat = 'MMM d HH:mm:ss',
) => {
  return isUTC
    ? formatInTimeZone(date, 'Etc/UTC', strFormat)
    : format(date, strFormat);
};
export const dateRangeToString = (range: [Date, Date], isUTC: boolean) => {
  return `${formatDate(range[0], isUTC)} - ${formatDate(range[1], isUTC)}`;
};

function isInputTimeQueryLive(inputTimeQuery: string) {
  return inputTimeQuery === '' || inputTimeQuery.includes(LIVE_TAIL_TIME_QUERY);
}

export function parseTimeQuery(
  timeQuery: string,
  isUTC: boolean,
): [Date | null, Date | null] {
  // If it's a live tail, return the last 15 minutes from now
  // Round to the nearest second as when we stop live tail, we'll query up to the nearest second
  // Without rounding, we'll end up needing to do a refetch for the ms differences
  if (timeQuery.includes(LIVE_TAIL_TIME_QUERY)) {
    const end = startOfSecond(new Date());
    return [sub(end, { minutes: 15 }), end];
  }

  const parsedTimeResult = chrono.parse(
    timeQuery,
    isUTC
      ? {
          timezone: 0, // 0 minute offset, UTC
        }
      : {},
  );
  const start =
    parsedTimeResult.length === 1
      ? parsedTimeResult[0].start?.date()
      : parsedTimeResult.length > 1
      ? parsedTimeResult[1].start?.date()
      : null;
  const end =
    parsedTimeResult.length === 1 && parsedTimeResult[0].end != null
      ? parsedTimeResult[0].end.date()
      : parsedTimeResult.length > 1 && parsedTimeResult[1].end != null
      ? parsedTimeResult[1].end.date()
      : start != null && start instanceof Date
      ? new Date()
      : null;

  return [start, end];
}

export function parseValidTimeRange(
  timeQuery: string,
  isUTC: boolean,
): [Date, Date] | undefined {
  const [start, end] = parseTimeQuery(timeQuery, isUTC);
  if (start != null && end != null) {
    return [start, end];
  }
  return undefined;
}

export function useTimeQuery({
  isUTC,
  defaultValue = LIVE_TAIL_TIME_QUERY,
  defaultTimeRange = [-1, -1],
  isLiveEnabled = true,
}: {
  isUTC: boolean;
  defaultValue?: string;
  defaultTimeRange?: [number, number];
  isLiveEnabled?: boolean;
}) {
  const router = useRouter();
  // We need to return true in SSR to prevent mismatch issues
  const isReady = typeof window === 'undefined' ? true : router.isReady;
  const prevIsReady = usePrevious(isReady);

  const [displayedTimeInputValue, setDisplayedTimeInputValue] = useState<
    undefined | string
  >(undefined);

  const [_timeRangeQuery, setTimeRangeQuery] = useQueryParams(
    {
      from: withDefault(NumberParam, undefined),
      to: withDefault(NumberParam, undefined),
    },
    {
      updateType: 'pushIn',
      enableBatching: true,
    },
  );

  const timeRangeQuery = useMemo(
    () => ({
      from: _timeRangeQuery.from ?? defaultTimeRange[0],
      to: _timeRangeQuery.to ?? defaultTimeRange[1],
    }),
    [_timeRangeQuery, defaultTimeRange],
  );

  // Allow browser back/fwd button to modify the displayed time input value
  const [inputTimeQuery, setInputTimeQuery] = useQueryParam(
    'tq',
    withDefault(StringParam, ''),
    {
      updateType: 'pushIn',
      enableBatching: true,
    },
  );
  const prevInputTimeQuery = usePrevious(inputTimeQuery);

  useEffect(() => {
    // Only trigger this once when the qparams have loaded
    if (isReady && !prevIsReady) {
      if (inputTimeQuery != '') {
        setDisplayedTimeInputValue(inputTimeQuery);
      } else if (_timeRangeQuery.from != null && _timeRangeQuery.to != null) {
        // If we're missing the time range query, let's parse it from the input time query
        const timeQueryDerivedInputValue = dateRangeToString(
          [new Date(_timeRangeQuery.from), new Date(_timeRangeQuery.to)],
          isUTC,
        );
        setDisplayedTimeInputValue(timeQueryDerivedInputValue);
        setInputTimeQuery(timeQueryDerivedInputValue);
      } else {
        setDisplayedTimeInputValue(defaultValue);
      }
    }
  }, [
    _timeRangeQuery,
    defaultValue,
    inputTimeQuery,
    isReady,
    isUTC,
    prevIsReady,
    setInputTimeQuery,
    setDisplayedTimeInputValue,
  ]);

  const [liveTailTimeRange, setLiveTailTimeRange] = useState<
    [Date, Date] | undefined
  >(undefined);
  // XXX: This hack is needed as setTimeRangeQuery doesn't update the query params immediately
  // when switching from live -> not live
  // this causes us to enter a temporary state where we're not live tailing,
  // and liveTailTimeRange is undefined but the timeRangeQuery is [-1, -1]
  // We still need to return the last live tail value or else we'll trigger
  // unnecessary searches with the wrong time range
  const [tempLiveTailTimeRange, setTempLiveTailTimeRange] = useState<
    [Date, Date] | undefined
  >(undefined);

  const timeQueryDerivedInputValue =
    isReady && timeRangeQuery.from != -1 && timeRangeQuery.to != -1
      ? dateRangeToString(
          [new Date(timeRangeQuery.from), new Date(timeRangeQuery.to)],
          isUTC,
        )
      : undefined;

  const inputTimeQueryDerivedTimeQueryRef = useRef<[Date, Date] | undefined>();

  // When the inputTimeQuery changes, we should calculate the time range
  // and set the timeRangeQuery if there is no existing time range query
  // if we're not supposed to be in live tail
  // Useful for relative time ranges where only tq is provided (ex. ?tq=Past+1d)
  useEffect(() => {
    if (
      isReady &&
      !isInputTimeQueryLive(inputTimeQuery) &&
      prevInputTimeQuery != inputTimeQuery
    ) {
      const timeRange = parseValidTimeRange(inputTimeQuery, isUTC);
      inputTimeQueryDerivedTimeQueryRef.current = timeRange;

      if (
        timeRange != null &&
        _timeRangeQuery.from == null &&
        _timeRangeQuery.to == null
      ) {
        setTimeRangeQuery({
          from: timeRange[0].getTime(),
          to: timeRange[1].getTime(),
        });
      }
    }
  }, [
    isReady,
    inputTimeQuery,
    isUTC,
    _timeRangeQuery,
    setTimeRangeQuery,
    prevInputTimeQuery,
  ]);

  // Derive searchedTimeRange
  const searchedTimeRange: [Date, Date] = useMemo(() => {
    if (isReady && timeRangeQuery.from != -1 && timeRangeQuery.to != -1) {
      // If we're ready and there's an existing time query, use that
      return [new Date(timeRangeQuery.from), new Date(timeRangeQuery.to)];
    } else if (
      isReady &&
      timeRangeQuery.from == -1 &&
      timeRangeQuery.to == -1 &&
      liveTailTimeRange != null
    ) {
      // If we're ready, and there's no time query, but we have a live tail time range, use that
      return liveTailTimeRange;
    } else if (
      isReady &&
      timeRangeQuery.from == -1 &&
      timeRangeQuery.to == -1 &&
      liveTailTimeRange == null &&
      tempLiveTailTimeRange != null
    ) {
      // This is a transitive state where timeRangeQuery hasn't been set yet
      // since setting qparams is async, but we've already unset liveTailTimeRange
      // Transitioning from live -> not live
      return tempLiveTailTimeRange;
    } else if (
      isReady &&
      timeRangeQuery.from == -1 &&
      timeRangeQuery.to == -1 &&
      liveTailTimeRange == null &&
      tempLiveTailTimeRange == null &&
      !isInputTimeQueryLive(inputTimeQuery) &&
      inputTimeQueryDerivedTimeQueryRef.current != null
    ) {
      // Use the input time query, allows users to specify relative time ranges
      // via url ex. /logs?tq=Last+30+minutes
      // return inputTimeQueryDerivedTimeQuery as [Date, Date];
      return inputTimeQueryDerivedTimeQueryRef.current;
    } else if (
      isReady &&
      timeRangeQuery.from == -1 &&
      timeRangeQuery.to == -1 &&
      liveTailTimeRange == null &&
      tempLiveTailTimeRange == null &&
      isInputTimeQueryLive(inputTimeQuery)
    ) {
      // If we haven't set a live tail time range yet, but we're ready and should be in live tail, let's just return one right now
      // this is due to the first interval of live tail not kicking in until 2 seconds after our first render
      const end = startOfSecond(new Date());
      const newLiveTailTimeRange: [Date, Date] = [
        sub(end, { minutes: 15 }),
        end,
      ];
      return newLiveTailTimeRange;
    } else {
      // We're not ready yet, safe to return anything.
      // Downstream querying components need to be disabled on isReady
      return [new Date(), new Date()];
    }
  }, [
    isReady,
    timeRangeQuery,
    liveTailTimeRange,
    tempLiveTailTimeRange,
    inputTimeQuery,
  ]);

  // ====================== LIVE MODE LOGIC ====================================
  // We'll only enter live mode once we're ready and see the qparams are not set
  // Live tail is defined by empty time range query, and inputTimeQuery either blank or containing 'Live Tail'
  const isLive = useMemo(() => {
    return (
      isReady &&
      isLiveEnabled &&
      timeRangeQuery.from == -1 &&
      timeRangeQuery.to == -1 &&
      (inputTimeQuery == '' || inputTimeQuery.includes(LIVE_TAIL_TIME_QUERY))
    );
  }, [isReady, isLiveEnabled, timeRangeQuery, inputTimeQuery]);
  const refreshLiveTailTimeRange = () => {
    const end = startOfSecond(new Date());
    setLiveTailTimeRange([sub(end, { minutes: 15 }), end]);
  };
  useEffect(() => {
    let interval: NodeJS.Timeout | undefined = undefined;

    if (isLive) {
      refreshLiveTailTimeRange();
      interval = setInterval(
        refreshLiveTailTimeRange,
        LIVE_TAIL_REFRESH_INTERVAL_MS,
      );
    }

    return () => {
      if (interval != null) {
        clearInterval(interval);
        interval = undefined;
      }
    };
  }, [isLive]);
  const setIsLive = useCallback(
    (newIsLive: boolean) => {
      if (isLive === false && newIsLive) {
        setTempLiveTailTimeRange(undefined);
        setTimeRangeQuery({ from: undefined, to: undefined });
        setDisplayedTimeInputValue(LIVE_TAIL_TIME_QUERY);
        setInputTimeQuery(LIVE_TAIL_TIME_QUERY);
        refreshLiveTailTimeRange();
      } else if (isLive && newIsLive === false && liveTailTimeRange != null) {
        const [start, end] = liveTailTimeRange;
        setTempLiveTailTimeRange(liveTailTimeRange);
        setTimeRangeQuery({ from: start.getTime(), to: end.getTime() });
        setLiveTailTimeRange(undefined);
        const dateRangeStr = dateRangeToString([start, end], isUTC);
        setDisplayedTimeInputValue(dateRangeStr);
        setInputTimeQuery(dateRangeStr);
      }
    },
    [
      isLive,
      setTimeRangeQuery,
      setDisplayedTimeInputValue,
      liveTailTimeRange,
      isUTC,
      setInputTimeQuery,
    ],
  );

  return {
    isReady, // Don't search until we know what we want to do
    isLive,
    displayedTimeInputValue:
      displayedTimeInputValue ?? timeQueryDerivedInputValue ?? defaultValue,
    setDisplayedTimeInputValue,
    searchedTimeRange,
    onSearch: useCallback(
      (timeQuery: string) => {
        if (timeQuery.includes(LIVE_TAIL_TIME_QUERY)) {
          setIsLive(true);
          return;
        }

        const [start, end] = parseTimeQuery(timeQuery, isUTC);
        // TODO: Add validation UI
        if (start != null && end != null) {
          setTimeRangeQuery({ from: start.getTime(), to: end.getTime() });
          if (timeQuery.toLowerCase().indexOf('past') === -1) {
            const dateRangeStr = dateRangeToString([start, end], isUTC);
            setDisplayedTimeInputValue(dateRangeStr);
            setInputTimeQuery(dateRangeStr);
          } else {
            setInputTimeQuery(timeQuery);
          }
        }
      },
      [
        isUTC,
        setTimeRangeQuery,
        setDisplayedTimeInputValue,
        setIsLive,
        setInputTimeQuery,
      ],
    ),
    onTimeRangeSelect: useCallback(
      (start: Date, end: Date) => {
        setTimeRangeQuery({ from: start.getTime(), to: end.getTime() });
        const dateRangeStr = dateRangeToString([start, end], isUTC);
        setDisplayedTimeInputValue(dateRangeStr);
        setInputTimeQuery(dateRangeStr);
      },
      [isUTC, setTimeRangeQuery, setDisplayedTimeInputValue, setInputTimeQuery],
    ),
    setIsLive,
  };
}
