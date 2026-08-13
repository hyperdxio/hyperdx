import { useMemo } from 'react';
import {
  MetricsDataType,
  TMetricSource,
} from '@hyperdx/common-utils/dist/types';

import { useGetKeyValues } from '@/hooks/useMetadata';

/**
 * Checks whether GPU metrics exist in the given metric source, scoped to a
 * correlated resource. Queries distinct MetricName values from the gauge
 * table, pushing a `MetricName:hw.gpu.*` filter into the query so the DB
 * only scans matching rows regardless of how many other metrics exist.
 *
 * Results are cached (staleTime 5 min by useGetKeyValues) so reopening the
 * panel does not re-query.
 */
export function useGpuMetricsAvailability({
  metricSource,
  correlationWhere,
  dateRange,
  enabled = true,
}: {
  metricSource: TMetricSource | undefined;
  correlationWhere: string;
  dateRange: [Date, Date];
  enabled?: boolean;
}): GpuMetricsAvailability {
  const gaugeTable = metricSource?.metricTables?.[MetricsDataType.Gauge];

  // Push prefix filter into the WHERE so we only scan hw.gpu.* rows.
  const gpuWhere = correlationWhere
    ? `(${correlationWhere}) AND MetricName:hw.gpu.*`
    : 'MetricName:hw.gpu.*';

  const chartConfig = useMemo(() => {
    if (!metricSource || !gaugeTable) return undefined;
    return {
      // Empty select: the query only needs MetricName values, not aggregates.
      select: [] as [],
      from: {
        databaseName: metricSource.from.databaseName,
        tableName: gaugeTable,
      },
      where: gpuWhere,
      whereLanguage: 'lucene' as const,
      groupBy: '',
      timestampValueExpression: metricSource.timestampValueExpression ?? '',
      connection: metricSource.connection,
      dateRange,
    };
  }, [metricSource, gaugeTable, gpuWhere, dateRange]);

  const { data, isLoading } = useGetKeyValues(
    { chartConfig, keys: ['MetricName'], disableRowLimit: true },
    { enabled: enabled && !!chartConfig },
  );

  return useMemo(() => {
    const metricNames: string[] = data?.[0]?.value ?? [];
    return {
      availableMetrics: new Set(metricNames),
      hasAny: metricNames.length > 0,
      isLoading,
    };
  }, [data, isLoading]);
}

export type GpuMetricsAvailability = {
  availableMetrics: Set<string>;
  hasAny: boolean;
  isLoading: boolean;
};

/**
 * Determines whether a specific chart's metric is available.
 */
export function resolveChartAvailability(
  fieldPrefix: string,
  chart: { field: string },
  availability: GpuMetricsAvailability,
): boolean {
  const metricName = `${fieldPrefix}${chart.field}`;
  return availability.availableMetrics.has(metricName);
}
