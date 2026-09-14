import { useMemo } from 'react';
import {
  DateRange,
  MetricsDataType,
  TMetricSource,
} from '@hyperdx/common-utils/dist/types';

import {
  useGetMetricNames,
  useMetadataWithSettings,
} from '@/hooks/useMetadata';
import { clampCatalogDateRange } from '@/hooks/useMetricCatalog';
import { useStreamingQuery } from '@/hooks/useStreamingQuery';
import type { QueryableMetricKind } from '@/utils/metricKinds';

const METRIC_NAME_COLUMN = 'MetricName';

type MetricNamesQueryArgs = ReturnType<typeof metricNamesQueryArgs>;

const metricNamesQueryArgs = ({
  dateRange,
  metricSource,
  metricType,
}: {
  dateRange?: DateRange['dateRange'];
  metricSource: TMetricSource;
  metricType: MetricsDataType;
}) => {
  // eslint-disable-next-line no-restricted-syntax
  const now = new Date();

  return {
    databaseName: metricSource.from.databaseName,
    // Empty when this source has no table for the kind, which disables the query
    // rather than emitting `FROM db.``` and failing on every render.
    tableName: metricSource.metricTables?.[metricType] ?? '',
    connectionId: metricSource.connection,
    timestampValueExpression: metricSource.timestampValueExpression ?? '',
    dateRange: clampCatalogDateRange(dateRange, now),
  };
};

/**
 * One kind's names, from whichever source suits the task.
 *
 * - **Browsing** (no `namePattern`) streams from the sparse primary index:
 *   near-free and progressive, but a subset weighted to high-volume metrics.
 * - **Searching** runs the exhaustive `GROUP BY` with the pattern in SQL:
 *   slower, but authoritative, so an omitted metric is always reachable.
 *
 * The exhaustive query also covers browsing when the index cannot be read —
 * old server, Distributed table, or `MetricName` outside the primary key.
 *
 * Returns the `{ data, isError, isFetching }` shape of the query it replaces,
 * so the aggregation in `useMetricNames` is indifferent to which path ran.
 */
function useMetricNamesForKind(
  args: MetricNamesQueryArgs,
  namePattern?: string,
) {
  const metadata = useMetadataWithSettings();
  // An unconfigured kind resolves to an empty table name.
  const isQueryable = !!args.databaseName && !!args.tableName;
  const isSearching = !!namePattern;

  const streamed = useStreamingQuery<string>({
    queryKey: [
      'useMetricNames.index',
      args.connectionId,
      args.databaseName,
      args.tableName,
      args.timestampValueExpression,
      args.dateRange[0].getTime(),
      args.dateRange[1].getTime(),
    ],
    // Not memoized: read when the query runs, not hashed into its key.
    streamFactory: ({ signal }) =>
      metadata.streamDistinctIndexValues({
        databaseName: args.databaseName,
        tableName: args.tableName,
        column: METRIC_NAME_COLUMN,
        connectionId: args.connectionId,
        dateRange: args.dateRange,
        timestampValueExpression: args.timestampValueExpression,
        signal,
      }),
    enabled: isQueryable && !isSearching,
  });

  const useExhaustive = isSearching || streamed.isError;
  const exhaustive = useGetMetricNames(
    { ...args, namePattern },
    { enabled: isQueryable && useExhaustive },
  );

  // A placeholder page holds the *previous* pattern's results, which cannot
  // match the new one — the consumer would filter them to nothing and flash an
  // empty picker, and its `truncated` flag describes a search already moved on
  // from. Hold the unfiltered browse list until the real page lands.
  const settled = useExhaustive && !exhaustive.isPlaceholderData;
  const streamedNames = streamed.data;

  return useMemo(() => {
    // The index emits in granule order, so sort — otherwise the options
    // reshuffle on every chunk. Search results are already relevance-ranked in
    // SQL, so they are never re-sorted.
    const browsed = streamedNames && {
      names: [...streamedNames].sort((a, b) => a.localeCompare(b)),
      truncated: false,
    };

    if (!useExhaustive) {
      return {
        data: browsed,
        isError: false,
        isFetching: streamed.isStreaming,
      };
    }
    if (exhaustive.isError) {
      // This kind has no answer for the pattern. Holding the browse list would
      // offer names that do not match what was typed.
      return {
        data: undefined,
        isError: true,
        isFetching: exhaustive.isFetching,
      };
    }
    if (settled && exhaustive.data) {
      return {
        data: exhaustive.data,
        isError: false,
        isFetching: exhaustive.isFetching,
      };
    }
    // In flight, or holding a placeholder page for another pattern. Offer both
    // sets: the consumer filters by the typed text, so only what matches
    // renders, and nothing blanks. Either alone is insufficient — a fallback
    // deployment has no browse list at all (`streamed.data` is suppressed on
    // error), and a browse list omits the index-invisible names that a
    // prefix-extending search's previous page still holds.
    const provisional = new Set([
      ...(browsed?.names ?? []),
      ...(exhaustive.data?.names ?? []),
    ]);
    return {
      data: provisional.size
        ? { names: [...provisional], truncated: false }
        : undefined,
      isError: false,
      isFetching: exhaustive.isFetching,
    };
  }, [
    settled,
    exhaustive.data,
    exhaustive.isError,
    exhaustive.isFetching,
    streamedNames,
    streamed.isStreaming,
    useExhaustive,
  ]);
}

/**
 * Metric names available on a metric source, one list per queryable kind.
 *
 * Names only, and deliberately so: it backs the always-mounted select, where a
 * grouped scan for unit/description would be too heavy. The explorer pays for
 * that richer catalog itself via `useMetricCatalog`, only while it is open.
 *
 * Without a `namePattern` the lists are streamed from the primary index and are
 * therefore incomplete; passing one switches every kind to the exhaustive
 * search. See `useMetricNamesForKind`.
 */
export function useMetricNames(
  metricSource: TMetricSource,
  dateRange?: DateRange['dateRange'],
  namePattern?: string,
) {
  const { gaugeArgs, histogramArgs, sumArgs, exponentialHistogramArgs } =
    useMemo(
      () => ({
        gaugeArgs: metricNamesQueryArgs({
          dateRange,
          metricSource,
          metricType: MetricsDataType.Gauge,
        }),
        histogramArgs: metricNamesQueryArgs({
          dateRange,
          metricSource,
          metricType: MetricsDataType.Histogram,
        }),
        sumArgs: metricNamesQueryArgs({
          dateRange,
          metricSource,
          metricType: MetricsDataType.Sum,
        }),
        exponentialHistogramArgs: metricNamesQueryArgs({
          dateRange,
          metricSource,
          metricType: MetricsDataType.ExponentialHistogram,
        }),
      }),
      [metricSource, dateRange],
    );

  const gauge = useMetricNamesForKind(gaugeArgs, namePattern);
  const histogram = useMetricNamesForKind(histogramArgs, namePattern);
  const sum = useMetricNamesForKind(sumArgs, namePattern);
  const exponentialHistogram = useMetricNamesForKind(
    exponentialHistogramArgs,
    namePattern,
  );

  const queries = [gauge, histogram, sum, exponentialHistogram];

  // Keyed by `QueryableMetricKind`, so adding a kind to `QUERYABLE_KINDS`
  // fails to compile here until a query for it is wired up above — rather than
  // quietly offering that kind in the dropdown with nothing behind it.
  const namesByKind: Record<QueryableMetricKind, string[] | undefined> = {
    [MetricsDataType.Gauge]: gauge.data?.names,
    [MetricsDataType.Sum]: sum.data?.names,
    [MetricsDataType.Histogram]: histogram.data?.names,
    [MetricsDataType.ExponentialHistogram]: exponentialHistogram.data?.names,
  };

  return {
    namesByKind,
    isTruncated: queries.some(query => query.data?.truncated),
    // Surfaced because a failed kind otherwise just vanishes from the list: the
    // query is not retried, so a transient error or a query too slow to finish
    // would silently omit those metrics from an apparently healthy dropdown.
    hasError: queries.some(query => query.isError),
    // Not `isLoading`: these queries keep the previous pattern's data while a
    // new one is in flight, so TanStack reports `success` and `isLoading` is
    // false for every search after the first mount.
    isFetching: queries.some(query => query.isFetching),
    // Only when every kind that answered returned nothing. A kind still in
    // flight must not read as "no such metric". A kind that *errored* is
    // deliberately not disqualifying: its table can be misconfigured
    // indefinitely, and blocking on it would restore the dead end this exists
    // to remove. When no kind answered at all, the `data !== undefined` check
    // already holds the offer back.
    hasNoMatches:
      queries.some(query => query.data !== undefined) &&
      queries.every(query => (query.data?.names?.length ?? 0) === 0) &&
      !queries.some(query => query.isFetching),
  };
}
