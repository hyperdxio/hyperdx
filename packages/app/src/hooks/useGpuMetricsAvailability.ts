import { useMemo } from 'react';
import {
  MetricsDataType,
  TMetricSource,
} from '@hyperdx/common-utils/dist/types';

import { useGetKeyValues } from '@/hooks/useMetadata';

/**
 * Checks whether GPU metrics exist in the given metric source, scoped to a
 * correlated resource. Queries distinct MetricName values from both the gauge
 * and sum tables, pushing a `MetricName:hw.gpu.*` filter into the query so
 * the DB only scans matching rows regardless of how many other metrics exist.
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
  const sumTable = metricSource?.metricTables?.[MetricsDataType.Sum];

  // Push prefix filter into the WHERE so we only scan hw.gpu.* rows.
  const gpuWhere = correlationWhere
    ? `(${correlationWhere}) AND MetricName:hw.gpu.*`
    : 'MetricName:hw.gpu.*';

  const gaugeConfig = useMemo(() => {
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

  const sumConfig = useMemo(() => {
    if (!metricSource || !sumTable) return undefined;
    return {
      select: [] as [],
      from: {
        databaseName: metricSource.from.databaseName,
        tableName: sumTable,
      },
      where: gpuWhere,
      whereLanguage: 'lucene' as const,
      groupBy: '',
      timestampValueExpression: metricSource.timestampValueExpression ?? '',
      connection: metricSource.connection,
      dateRange,
    };
  }, [metricSource, sumTable, gpuWhere, dateRange]);

  const { data: gaugeData, isLoading: isGaugeLoading } = useGetKeyValues(
    { chartConfig: gaugeConfig, keys: ['MetricName'], disableRowLimit: true },
    { enabled: enabled && !!gaugeConfig },
  );

  const { data: sumData, isLoading: isSumLoading } = useGetKeyValues(
    { chartConfig: sumConfig, keys: ['MetricName'], disableRowLimit: true },
    { enabled: enabled && !!sumConfig },
  );

  return useMemo(() => {
    const gaugeNames: string[] = gaugeData?.[0]?.value ?? [];
    const sumNames: string[] = sumData?.[0]?.value ?? [];

    return {
      gaugeMetrics: new Set(gaugeNames),
      sumMetrics: new Set(sumNames),
      hasAny: gaugeNames.length > 0 || sumNames.length > 0,
      isLoading: isGaugeLoading || isSumLoading,
    };
  }, [gaugeData, sumData, isGaugeLoading, isSumLoading]);
}

export type GpuMetricsAvailability = {
  gaugeMetrics: Set<string>;
  sumMetrics: Set<string>;
  hasAny: boolean;
  isLoading: boolean;
};

/**
 * Determines whether a specific chart's primary metric is available,
 * or whether its fallback metrics are available.
 */
export function resolveChartAvailability(
  fieldPrefix: string,
  chart: {
    field: string;
    metricType?: string;
    fallback?: { fields: readonly [string, string]; metricType: string };
  },
  availability: GpuMetricsAvailability,
): 'primary' | 'fallback' | 'none' {
  const primaryMetric = `${fieldPrefix}${chart.field}`;
  const primaryType = chart.metricType ?? 'Gauge';
  const metricsSet =
    primaryType === 'Sum' ? availability.sumMetrics : availability.gaugeMetrics;

  if (metricsSet.has(primaryMetric)) {
    return 'primary';
  }

  if (chart.fallback) {
    const fallbackSet =
      chart.fallback.metricType === 'Sum'
        ? availability.sumMetrics
        : availability.gaugeMetrics;
    const [num, den] = chart.fallback.fields;
    if (
      fallbackSet.has(`${fieldPrefix}${num}`) &&
      fallbackSet.has(`${fieldPrefix}${den}`)
    ) {
      return 'fallback';
    }
  }

  return 'none';
}
