import { useMemo } from 'react';
import { addDays, differenceInDays, subDays } from 'date-fns';
import {
  DateRange,
  MetricsDataType,
  TMetricSource,
} from '@hyperdx/common-utils/dist/types';

import { useGetMetricNames } from '@/hooks/useMetadata';

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
  let _dateRange: DateRange['dateRange'] = dateRange
    ? dateRange
    : [subDays(now, 1), now];
  const diffInDays = differenceInDays(_dateRange[1], _dateRange[0]);

  if (diffInDays < 1) {
    const nextDay = addDays(_dateRange[0], 1);
    if (nextDay > now) {
      _dateRange = [subDays(_dateRange[1], 1), _dateRange[1]];
    } else {
      _dateRange = [_dateRange[0], nextDay];
    }
  } else if (diffInDays > 3) {
    // most recent 3 days
    _dateRange = [subDays(_dateRange[1], 3), _dateRange[1]];
  }

  return {
    databaseName: metricSource.from.databaseName,
    // Empty when this source has no table for the kind, which disables the query
    // rather than emitting `FROM db.``` and failing on every render.
    tableName: metricSource.metricTables?.[metricType] ?? '',
    connectionId: metricSource.connection,
    timestampValueExpression: metricSource.timestampValueExpression ?? '',
    dateRange: _dateRange,
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

  return {
    gaugeMetrics: gauge.data?.names,
    histogramMetrics: histogram.data?.names,
    sumMetrics: sum.data?.names,
    exponentialHistogramMetrics: exponentialHistogram.data?.names,
    isTruncated: queries.some(query => query.data?.truncated),
    // Surfaced because a failed kind otherwise just vanishes from the list: the
    // query is not retried, so a transient error or a query too slow to finish
    // would silently omit those metrics from an apparently healthy dropdown.
    hasError: queries.some(query => query.isError),
    isLoading: queries.some(query => query.isLoading),
    // Only when every enabled kind has actually answered with nothing. Loading
    // and error must not read as "no such metric", or a slow or broken query
    // would invite the caller to commit a name that does exist. `isFetching` is
    // part of that guard because these queries keep the previous page's data
    // while a new pattern is in flight.
    hasNoMatches:
      queries.some(query => query.data !== undefined) &&
      queries.every(query => (query.data?.names?.length ?? 0) === 0) &&
      !queries.some(
        query => query.isLoading || query.isFetching || query.isError,
      ),
  };
}
