import { useMemo } from 'react';
import {
  DateRange,
  MetricsDataType,
  TMetricSource,
} from '@hyperdx/common-utils/dist/types';

import { useGetMetricNames } from '@/hooks/useMetadata';
import { clampCatalogDateRange } from '@/hooks/useMetricCatalog';
import type { QueryableMetricKind } from '@/utils/metricKinds';

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
 * Metric names available on a metric source, one list per queryable kind.
 *
 * Names only, and deliberately so: it backs the always-mounted select, where a
 * grouped scan for unit/description would be too heavy. The explorer pays for
 * that richer catalog itself via `useMetricCatalog`, only while it is open.
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

  const gauge = useGetMetricNames({ ...gaugeArgs, namePattern });
  const histogram = useGetMetricNames({ ...histogramArgs, namePattern });
  const sum = useGetMetricNames({ ...sumArgs, namePattern });
  const exponentialHistogram = useGetMetricNames({
    ...exponentialHistogramArgs,
    namePattern,
  });

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
