import { useMemo } from 'react';
import {
  MetricsDataType,
  TMetricSource,
} from '@hyperdx/common-utils/dist/types';

import { useGetKeyValues } from '@/hooks/useMetadata';

export const GPU_METRIC_NAMES = {
  utilization: 'hw.gpu.utilization',
  memoryUtilization: 'hw.gpu.memory.utilization',
} as const;

export type GpuMetricsAvailability = {
  hasUtilization: boolean;
  hasMemoryUtilization: boolean;
  hasAny: boolean;
  isLoading: boolean;
};

/**
 * Checks whether GPU metrics exist in the given metric source, scoped to a
 * correlated resource (by host/node). Queries distinct MetricName values from
 * the gauge table filtered by the resource correlation WHERE clause.
 *
 * Results are cached (staleTime 5 min by useGetKeyValues) so reopening the
 * panel does not re-query.
 */
export function useGpuMetricsAvailability({
  metricSource,
  where,
  dateRange,
  enabled = true,
}: {
  metricSource: TMetricSource | undefined;
  where: string;
  dateRange: [Date, Date];
  enabled?: boolean;
}): GpuMetricsAvailability {
  const gaugeTable = metricSource?.metricTables?.[MetricsDataType.Gauge];

  const chartConfig = useMemo(() => {
    if (!metricSource || !gaugeTable) return undefined;
    return {
      select: [] as [],
      from: {
        databaseName: metricSource.from.databaseName,
        tableName: gaugeTable,
      },
      where,
      whereLanguage: 'lucene' as const,
      groupBy: '',
      timestampValueExpression: metricSource.timestampValueExpression ?? '',
      connection: metricSource.connection,
      dateRange,
    };
  }, [metricSource, gaugeTable, where, dateRange]);

  const { data, isLoading } = useGetKeyValues(
    {
      chartConfig,
      keys: ['MetricName'],
      limit: 50,
      disableRowLimit: true,
    },
    {
      enabled: enabled && !!chartConfig,
    },
  );

  return useMemo(() => {
    const metricNames: string[] = data?.[0]?.value ?? [];
    const gpuNames = metricNames.filter(name => name.startsWith('hw.gpu.'));
    return {
      hasUtilization: gpuNames.includes(GPU_METRIC_NAMES.utilization),
      hasMemoryUtilization: gpuNames.includes(
        GPU_METRIC_NAMES.memoryUtilization,
      ),
      hasAny: gpuNames.length > 0,
      isLoading,
    };
  }, [data, isLoading]);
}
