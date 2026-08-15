import { useMemo } from 'react';
import {
  MetricsDataType,
  TMetricSource,
} from '@hyperdx/common-utils/dist/types';

import { useGetKeyValues } from '@/hooks/useMetadata';

/**
 * Resolves which of `metricNames` actually exist in the metric source for a
 * correlated resource, so a chart group can hide the charts it has no data for.
 *
 * The query asks only about the candidate names rather than enumerating every
 * distinct MetricName on the host. That matters: the metadata layer aggregates
 * values with `groupUniqArray(limit)`, so an open-ended lookup can silently
 * drop the name we are looking for on a metric-heavy host and hide a chart
 * that does have data. Bounding the universe to the candidates — and sizing
 * the limit to match — makes truncation impossible.
 *
 * Results are cached by useGetKeyValues (5 min staleTime), so reopening the
 * panel does not re-query.
 */
export function useAvailableMetricNames({
  metricSource,
  correlationWhere,
  metricNames,
  dateRange,
  enabled = true,
}: {
  metricSource: TMetricSource | undefined;
  correlationWhere: string;
  metricNames: readonly string[];
  dateRange: [Date, Date];
  enabled?: boolean;
}): { availableMetrics: Set<string>; isLoading: boolean } {
  const gaugeTable = metricSource?.metricTables?.[MetricsDataType.Gauge];

  // Callers pass a memoized `metricNames`, so this rebuilds only when the
  // candidate set actually changes rather than on every render.
  const chartConfig = useMemo(() => {
    if (!metricSource || !gaugeTable || metricNames.length === 0) {
      return undefined;
    }
    const nameFilter = metricNames.map(n => `MetricName:"${n}"`).join(' OR ');
    return {
      // Empty select: only the grouped MetricName values are needed.
      select: [] as [],
      from: {
        databaseName: metricSource.from.databaseName,
        tableName: gaugeTable,
      },
      where: correlationWhere
        ? `(${correlationWhere}) AND (${nameFilter})`
        : nameFilter,
      whereLanguage: 'lucene' as const,
      groupBy: '',
      timestampValueExpression: metricSource.timestampValueExpression ?? '',
      connection: metricSource.connection,
      dateRange,
    };
  }, [metricSource, gaugeTable, correlationWhere, metricNames, dateRange]);

  const { data, isLoading } = useGetKeyValues(
    {
      chartConfig,
      keys: ['MetricName'],
      // The value universe is exactly the candidate list, so this cannot cut
      // off a name we asked about.
      limit: metricNames.length,
      disableRowLimit: true,
    },
    { enabled: enabled && !!chartConfig },
  );

  return useMemo(
    () => ({
      availableMetrics: new Set<string>(data?.[0]?.value ?? []),
      isLoading,
    }),
    [data, isLoading],
  );
}
