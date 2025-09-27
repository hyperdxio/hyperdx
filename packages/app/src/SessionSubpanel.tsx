import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import cx from 'classnames';
import throttle from 'lodash/throttle';
import { parseAsInteger, useQueryState } from 'nuqs';
import ReactDOM from 'react-dom';
import { useForm } from 'react-hook-form';
import { tcFromSource } from '@hyperdx/common-utils/dist/metadata';
import {
  ChartConfigWithOptDateRange,
  DateRange,
  SearchCondition,
  SearchConditionLanguage,
  TSource,
} from '@hyperdx/common-utils/dist/types';
import {
  ActionIcon,
  Button,
  Divider,
  Group,
  SegmentedControl,
  Tooltip,
} from '@mantine/core';

import DBRowSidePanel from '@/components/DBRowSidePanel';

import { SQLInlineEditorControlled } from './components/SQLInlineEditor';
import DOMPlayer from './DOMPlayer';
import Playbar from './Playbar';
import SearchInputV2 from './SearchInputV2';
import { SessionEventList } from './SessionEventList';
import { FormatTime } from './useFormatTime';
import { formatmmss, useLocalStorage, usePrevious } from './utils';

import styles from '../styles/SessionSubpanelV2.module.scss';

const MemoPlaybar = memo(Playbar);

export default function SessionSubpanel({
  traceSource,
  sessionSource,
  session,
  onPropertyAddClick,
  generateChartUrl,
  generateSearchUrl,
  setDrawerOpen,
  rumSessionId,
  start,
  end,
  initialTs,
  where,
  whereLanguage = 'lucene',
}: {
  traceSource: TSource;
  sessionSource: TSource;
  session: { serviceName: string };
  generateSearchUrl?: (query?: string, timeRange?: [Date, Date]) => string;
  generateChartUrl?: (config: {
    aggFn: string;
    field: string;
    groupBy: string[];
  }) => string;

  onPropertyAddClick?: (name: string, value: string) => void;
  setDrawerOpen: (open: boolean) => void;
  rumSessionId: string;
  start: Date;
  end: Date;
  initialTs?: number;
  where?: SearchCondition;
  whereLanguage?: SearchConditionLanguage;
}) {
  const [rowId, setRowId] = useState<string | undefined>(undefined);

  // Without portaling the nested drawer close overlay will not render properly
  const containerRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    containerRef.current = document.createElement('div');

    if (containerRef.current) {
      document.body.appendChild(containerRef.current);
    }

    return () => {
      if (containerRef.current) {
        document.body.removeChild(containerRef.current);
      }
    };
  }, []);

  const portaledPanel =
    containerRef.current != null
      ? ReactDOM.createPortal(
          traceSource && (
            <DBRowSidePanel
              source={traceSource}
              isNestedPanel
              rowId={rowId}
              onClose={() => {
                setDrawerOpen(false);
                setRowId(undefined);
              }}
            />
          ),
          containerRef.current,
        )
      : null;

  const [tsQuery, setTsQuery] = useQueryState(
    'ts',
    parseAsInteger.withOptions({ history: 'replace' }),
  );
  const prevTsQuery = usePrevious(tsQuery);

  useEffect(() => {
    if (prevTsQuery == null && tsQuery != null) {
      _setFocus({ ts: tsQuery, setBy: 'url' });
    }
  }, [prevTsQuery, tsQuery]);

  const debouncedSetTsQuery = useRef(
    throttle(async (ts: number) => {
      setTsQuery(ts);
    }, 1000),
  ).current;

  useEffect(() => {
    return () => {
      setTsQuery(null);
    };
  }, [setTsQuery]);

  const [focus, _setFocus] = useState<
    { ts: number; setBy: string } | undefined
  >(
    initialTs != null
      ? {
          ts: initialTs,
          setBy: 'parent',
        }
      : undefined,
  );

  const setFocus = useCallback(
    (focus: { ts: number; setBy: string }) => {
      if (focus.setBy === 'player') {
        debouncedSetTsQuery(focus.ts);
      } else {
        setTsQuery(focus.ts);
      }
      _setFocus(focus);
    },
    [_setFocus, setTsQuery, debouncedSetTsQuery],
  );
  const [playerState, setPlayerState] = useState<'paused' | 'playing'>(
    'paused',
  );

  // Event Filter Input =========================
  const inputRef = useRef<HTMLInputElement>(null);
  const [_inputQuery, setInputQuery] = useState<string | undefined>(undefined);
  const inputQuery = _inputQuery ?? '';
  const [_searchedQuery, setSearchedQuery] = useQueryState('session_q', {
    history: 'push',
  });

  // Hacky way to set the input query when we search
  useEffect(() => {
    if (_searchedQuery != null && _inputQuery == null) {
      setInputQuery(_searchedQuery);
    }
  }, [_searchedQuery, _inputQuery]);

  // Allows us to determine if the user has changed the search query
  const searchedQuery = _searchedQuery ?? '';

  // Clear search query when we close the panel
  useEffect(() => {
    return () => {
      setSearchedQuery(null, { history: 'replace' });
    };
  }, [setSearchedQuery]);

  // Focused Tab ===============================
  const [tab, setTab] = useState<string>('highlighted');

  // Playbar ====================================
  const [showRelativeTime, setShowRelativeTime] = useLocalStorage(
    'hdx-session-subpanel-show-relative-time',
    false,
  );
  const [playerSpeed, setPlayerSpeed] = useLocalStorage(
    'hdx-session-subpanel-player-speed',
    1,
  );
  const [skipInactive, setSkipInactive] = useLocalStorage(
    'hdx-session-subpanel-skip-inactive',
    true,
  );
  const [eventsFollowPlayerPosition, setEventsFollowPlayerPosition] =
    useLocalStorage('hdx-session-subpanel-events-follow-player-position', true);

  // XXX: This is a hack for the hack, we offset start/end by 4 hours
  // to ensure we capture all rrweb events on query. However, we
  // need to un-offset the time for the playback slider to show sane values.
  // these values get updated by the DOM player when events are loaded
  const [playerStartTs, setPlayerStartTs] = useState<number>(
    start.getTime() + 4 * 60 * 60 * 1000,
  );
  const [playerEndTs, setPlayerEndTs] = useState<number>(
    end.getTime() - 4 * 60 * 60 * 1000,
  );
  const playbackRange = useMemo(() => {
    return [
      new Date(playerStartTs),
      new Date(playerEndTs),
    ] as DateRange['dateRange'];
  }, [playerStartTs, playerEndTs]);

  const commonSelect = useMemo(
    () => [
      // body
      // component
      // duration
      // end_timestamp
      // error.message
      // exception.group_id
      // http.method
      // http.status_code
      // http.url
      // id
      // location.href
      // otel.library.name
      // parent_span_id
      // severity_text
      // sort_key
      // span_id
      // span_name
      // timestamp
      // trace_id
      // type
      // _host
      // _platform
      // _service
      {
        // valueExpression: `${traceSource.statusCodeExpression}`,
        valueExpression: `${traceSource.eventAttributesExpression}['message']`,
        alias: 'body',
      },
      {
        valueExpression: `${traceSource.eventAttributesExpression}['component']`,
        alias: 'component',
      },
      {
        valueExpression: `toFloat64OrZero(toString(${traceSource.durationExpression})) * pow(10, 3) / pow(10, toInt8OrZero(toString(${traceSource.durationPrecision})))`,
        alias: 'durationInMs',
      },
      {
        valueExpression: `${traceSource.eventAttributesExpression}['error.message']`,
        alias: 'error.message',
      },
      {
        valueExpression: `${traceSource.eventAttributesExpression}['http.method']`,
        alias: 'http.method',
      },
      {
        valueExpression: `${traceSource.eventAttributesExpression}['http.status_code']`,
        alias: 'http.status_code',
      },
      {
        valueExpression: `${traceSource.eventAttributesExpression}['http.url']`,
        alias: 'http.url',
      },
      {
        valueExpression: `cityHash64(${traceSource.traceIdExpression}, ${traceSource.parentSpanIdExpression}, ${traceSource.spanIdExpression}, ${traceSource.timestampValueExpression})`,
        alias: 'id',
      },
      {
        valueExpression: `${traceSource.eventAttributesExpression}['location.href']`,
        alias: 'location.href',
      },
      {
        valueExpression: 'ScopeName', // FIXME: add mapping
        alias: 'otel.library.name',
      },
      {
        valueExpression: `${traceSource.parentSpanIdExpression}`,
        alias: 'parent_span_id',
      },
      {
        valueExpression: `${traceSource.statusCodeExpression}`,
        alias: 'severity_text',
      },
      {
        valueExpression: `${traceSource.spanIdExpression}`,
        alias: 'span_id',
      },
      {
        valueExpression: `${traceSource.spanNameExpression}`,
        alias: 'span_name',
      },
      {
        valueExpression: `${traceSource.timestampValueExpression}`,
        alias: 'timestamp',
      },
      {
        valueExpression: `${traceSource.traceIdExpression}`,
        alias: 'trace_id',
      },
      {
        valueExpression: `CAST('span', 'String')`,
        alias: 'type',
      },
    ],
    [traceSource],
  );

  // Events shown in the highlighted tab
  const highlightedEventsFilter = useMemo(
    () => ({
      type: 'lucene' as const,
      condition: `${traceSource.resourceAttributesExpression}.rum.sessionId:"${rumSessionId}"
    AND (
      ${traceSource.eventAttributesExpression}.http.status_code:>299 
      OR ${traceSource.eventAttributesExpression}.component:"error" 
      OR ${traceSource.spanNameExpression}:"routeChange" 
      OR ${traceSource.spanNameExpression}:"documentLoad" 
      OR ${traceSource.spanNameExpression}:"intercom.onShow" 
      OR ScopeName:"custom-action" 
    )`,
    }),
    [traceSource, rumSessionId],
  );

  const allEventsFilter = useMemo(
    () => ({
      type: 'lucene' as const,
      condition: `${traceSource.resourceAttributesExpression}.rum.sessionId:"${rumSessionId}"
    AND (
      ${traceSource.eventAttributesExpression}.http.status_code:* 
      OR ${traceSource.eventAttributesExpression}.component:"console" 
      OR ${traceSource.eventAttributesExpression}.component:"error" 
      OR ${traceSource.spanNameExpression}:"routeChange" 
      OR ${traceSource.spanNameExpression}:"documentLoad" 
      OR ${traceSource.spanNameExpression}:"intercom.onShow" 
      OR ScopeName:"custom-action" 
    )`,
    }),
    [traceSource, rumSessionId],
  );

  const playBarEventsConfig = useMemo<ChartConfigWithOptDateRange>(
    () => ({
      select: commonSelect,
      from: traceSource.from,
      dateRange: [start, end],
      whereLanguage: 'lucene',
      where: searchedQuery,
      timestampValueExpression: traceSource.timestampValueExpression,
      implicitColumnExpression: traceSource.implicitColumnExpression,
      connection: traceSource.connection,
      orderBy: `${traceSource.timestampValueExpression} ASC`,
      limit: {
        limit: 4000,
        offset: 0,
      },
      filters: [
        tab === 'highlighted' ? highlightedEventsFilter : allEventsFilter,
        // ...(where ? [{ type: whereLanguage, condition: where }] : []),
      ],
    }),
    [
      commonSelect,
      traceSource.from,
      traceSource.timestampValueExpression,
      traceSource.implicitColumnExpression,
      traceSource.connection,
      start,
      end,
      // whereLanguage,
      searchedQuery,
      tab,
      highlightedEventsFilter,
      allEventsFilter,
      // where,
    ],
  );
  const [playerFullWidth, setPlayerFullWidth] = useState(false);

  const aliasMap = useMemo(() => {
    // valueExpression: alias
    return commonSelect.reduce(
      (acc, { valueExpression, alias }) => {
        acc[alias] = valueExpression;
        return acc;
      },
      {} as Record<string, string>,
    );
  }, [commonSelect]);

  const sessionEventListConfig = useMemo<ChartConfigWithOptDateRange>(
    () => ({
      select: commonSelect,
      from: traceSource.from,
      dateRange: [start, end],
      whereLanguage: 'lucene',
      where: searchedQuery,
      timestampValueExpression: traceSource.timestampValueExpression,
      implicitColumnExpression: traceSource.implicitColumnExpression,
      connection: traceSource.connection,
      orderBy: `${traceSource.timestampValueExpression} ASC`,
      limit: {
        limit: 4000,
        offset: 0,
      },
      filters: [
        tab === 'highlighted' ? highlightedEventsFilter : allEventsFilter,
        // ...(where ? [{ type: whereLanguage, condition: where }] : []),
      ],
    }),
    [
      commonSelect,
      traceSource.from,
      traceSource.timestampValueExpression,
      traceSource.implicitColumnExpression,
      traceSource.connection,
      start,
      end,
      searchedQuery,
      tab,
      highlightedEventsFilter,
      allEventsFilter,
    ],
  );

  const handleSetPlayerSpeed = useCallback(() => {
    if (playerSpeed == 1) {
      setPlayerSpeed(2);
    } else if (playerSpeed == 2) {
      setPlayerSpeed(4);
    } else if (playerSpeed == 4) {
      setPlayerSpeed(8);
    } else if (playerSpeed == 8) {
      setPlayerSpeed(1);
    }
  }, [playerSpeed, setPlayerSpeed]);

  const minTs = playbackRange[0].getTime();
  const maxTs = playbackRange[1].getTime();

  const togglePlayerState = useCallback(() => {
    setPlayerState(state => (state === 'playing' ? 'paused' : 'playing'));
  }, [setPlayerState]);

  const skipBackward = useCallback(() => {
    setFocus({
      ts: Math.max((focus?.ts ?? minTs) - 15000, minTs),
      setBy: 'skip-backward',
    });
  }, [setFocus, focus?.ts, minTs]);

  const skipForward = useCallback(() => {
    setFocus({
      ts: Math.min((focus?.ts ?? minTs) + 15000, maxTs),
      setBy: 'skip-forward',
    });
  }, [setFocus, focus?.ts, minTs, maxTs]);

  const { control, handleSubmit } = useForm({
    values: {
      where: searchedQuery,
    },
  });
  const handleWhereSubmit = useCallback(
    (values: { where: string }) => {
      setSearchedQuery(values.where);
    },
    [setSearchedQuery],
  );

  return (
    <div className={styles.wrapper}>
      {rowId != null && portaledPanel}
      <div className={cx(styles.eventList, { 'd-none': playerFullWidth })}>
        <div className={styles.eventListHeader}>
          <form
            style={{ zIndex: 100, width: '100%' }}
            onSubmit={handleSubmit(handleWhereSubmit)}
          >
            {whereLanguage === 'sql' ? (
              <SQLInlineEditorControlled
                tableConnection={tcFromSource(traceSource)}
                control={control}
                name="where"
                placeholder="SQL WHERE clause (ex. column = 'foo')"
                language="sql"
                size="xs"
                enableHotkey
              />
            ) : (
              <SearchInputV2
                tableConnection={tcFromSource(traceSource)}
                control={control}
                name="where"
                language="lucene"
                size="xs"
                placeholder="Search your events w/ Lucene ex. column:foo"
                enableHotkey
              />
            )}
          </form>
          <Group gap={6}>
            <SegmentedControl
              flex={1}
              size="xs"
              data={[
                { value: 'highlighted', label: 'Highlighted' },
                { value: 'events', label: 'All Events' },
              ]}
              value={tab}
              onChange={value => setTab(value)}
            />
            <Tooltip label="Sync with player position" color="gray">
              <ActionIcon
                size="md"
                color="gray"
                variant={eventsFollowPlayerPosition ? 'filled' : 'subtle'}
                onClick={() =>
                  setEventsFollowPlayerPosition(!eventsFollowPlayerPosition)
                }
              >
                <i className="bi bi-chevron-bar-contract fs-6" />
              </ActionIcon>
            </Tooltip>
          </Group>
        </div>

        <SessionEventList
          eventsFollowPlayerPosition={eventsFollowPlayerPosition}
          aliasMap={aliasMap}
          queriedConfig={sessionEventListConfig}
          onClick={useCallback(
            (id: string) => {
              setDrawerOpen(true);
              setRowId(id);
            },
            [setDrawerOpen, setRowId],
          )}
          focus={focus}
          onTimeClick={useCallback(
            ts => {
              setFocus({ ts, setBy: 'timeline' });
            },
            [setFocus],
          )}
          minTs={minTs}
          showRelativeTime={showRelativeTime}
        />
      </div>

      <div className={styles.player}>
        <DOMPlayer
          playerState={playerState}
          setPlayerState={setPlayerState}
          focus={focus}
          setPlayerTime={useCallback(
            ts => {
              if (focus?.setBy !== 'player' || focus?.ts !== ts) {
                setFocus({ ts, setBy: 'player' });
              }
            },
            [focus, setFocus],
          )}
          config={{
            serviceName: session.serviceName,
            sourceId: sessionSource.id,
            sessionId: rumSessionId,
            dateRange: [start, end],
          }}
          playerSpeed={playerSpeed}
          skipInactive={skipInactive}
          setPlayerStartTimestamp={setPlayerStartTs}
          setPlayerEndTimestamp={setPlayerEndTs}
          setPlayerFullWidth={setPlayerFullWidth}
          playerFullWidth={playerFullWidth}
          resizeKey={`${playerFullWidth}`}
        />

        <div className={styles.playerPlaybar}>
          <MemoPlaybar
            playerState={playerState}
            setPlayerState={setPlayerState}
            focus={focus}
            setFocus={setFocus}
            playbackRange={playbackRange}
            queriedConfig={playBarEventsConfig}
          />
        </div>
        <div className={styles.playerToolbar}>
          <div className={styles.playerTimestamp}>
            <Tooltip label="Toggle relative time" color="gray">
              <Button
                variant="subtle"
                color="gray"
                onClick={() => setShowRelativeTime(!showRelativeTime)}
                size="compact-xs"
              >
                {showRelativeTime ? (
                  <>
                    {formatmmss((focus?.ts ?? 0) - minTs)}
                    <span className="fw-normal text-slate-300 ms-2">
                      {' / '}
                      {formatmmss(maxTs - minTs)}
                    </span>
                  </>
                ) : (
                  <FormatTime value={focus?.ts || minTs} format="time" />
                )}
              </Button>
            </Tooltip>
          </div>
          <Group align="center" justify="center" gap="xs">
            <Tooltip label="Go 15 seconds back" color="gray">
              <ActionIcon
                variant="filled"
                color="gray.8"
                size="md"
                radius="xl"
                onClick={skipBackward}
                disabled={(focus?.ts || 0) <= minTs}
              >
                <i className="bi bi-arrow-counterclockwise fs-6" />
              </ActionIcon>
            </Tooltip>
            <Tooltip
              label={playerState === 'playing' ? 'Pause' : 'Play'}
              color="gray"
            >
              <ActionIcon
                variant="filled"
                color="gray.8"
                size="lg"
                radius="xl"
                onClick={togglePlayerState}
              >
                <i
                  className={`bi fs-4 ${
                    playerState === 'paused' ? 'bi-play-fill' : 'bi-pause-fill'
                  }`}
                />
              </ActionIcon>
            </Tooltip>
            <Tooltip label="Skip 15 seconds" color="gray">
              <ActionIcon
                variant="filled"
                color="gray.8"
                size="md"
                radius="xl"
                onClick={skipForward}
                disabled={(focus?.ts || 0) >= maxTs}
              >
                <i className="bi bi-arrow-clockwise fs-6" />
              </ActionIcon>
            </Tooltip>
          </Group>
          <Group align="center" justify="flex-end" gap="xs">
            <Button
              size="compact-sm"
              color="gray"
              variant="light"
              fw="normal"
              rightSection={
                <i
                  className={`bi ${
                    skipInactive ? 'bi-toggle-off' : 'bi-toggle-on'
                  } fs-6 pe-1`}
                />
              }
              onClick={() => setSkipInactive(!skipInactive)}
            >
              Skip Idle
              <Divider orientation="vertical" ml="sm" />
            </Button>
            <Button
              size="compact-sm"
              color="gray"
              variant="light"
              fw="normal"
              rightSection={
                <span className="fw-bold pe-1">{playerSpeed}x</span>
              }
              onClick={handleSetPlayerSpeed}
            >
              Speed
              <Divider orientation="vertical" ml="sm" />
            </Button>
          </Group>
        </div>
      </div>
    </div>
  );
}
