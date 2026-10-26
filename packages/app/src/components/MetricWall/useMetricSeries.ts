import { useMemo } from 'react';
import { BuilderChartConfigWithDateRange } from '@hyperdx/common-utils/dist/types';

import {
  convertToTimeChartConfig,
  formatResponseForTimeChart,
  useTimeChartSettings,
} from '@/ChartUtils';
import { sparklinePointsFromGraphResults } from '@/components/NumberTileBackgroundChart';
import { SparklinePoint } from '@/components/Sparkline';
import { useQueriedChartConfig } from '@/hooks/useChartConfig';

export type MetricSeries = {
  key: string;
  label: string;
  color: string;
  points: SparklinePoint[];
  latest?: number;
};

/**
 * Run a tile's time-series query and hand back each series as sparkline
 * points, so one query can feed a single tile or a row of small multiples.
 */
export function useMetricSeries(
  config: BuilderChartConfigWithDateRange,
  { enabled = true }: { enabled?: boolean } = {},
) {
  const { dateRange, granularity } = useTimeChartSettings(config);
  const queriedConfig = useMemo(
    () => convertToTimeChartConfig(config),
    [config],
  );
  const { data, isLoading, isError, error } = useQueriedChartConfig(
    queriedConfig,
    {
      enabled,
      placeholderData: prev => prev,
      queryKey: ['metric-wall-series', queriedConfig],
    },
  );

  const series = useMemo<MetricSeries[]>(() => {
    if (data == null) return [];
    try {
      const { graphResults, timestampColumn, lineData } =
        formatResponseForTimeChart({
          currentPeriodResponse: data,
          dateRange,
          granularity,
          generateEmptyBuckets: false,
        });
      return lineData.map(line => {
        const points = sparklinePointsFromGraphResults(
          graphResults,
          timestampColumn?.name,
          line.dataKey,
        );
        return {
          key: line.dataKey,
          label: line.displayName,
          color: line.color,
          points,
          latest: points[points.length - 1]?.y,
        };
      });
    } catch {
      return [];
    }
  }, [data, dateRange, granularity]);

  return { series, isLoading, isError, error };
}

const compact = new Intl.NumberFormat(undefined, {
  notation: 'compact',
  maximumFractionDigits: 1,
});

export function formatMetricValue(value: number | undefined, unit?: string) {
  if (value == null || !Number.isFinite(value)) return '–';
  const number = compact.format(value);
  return unit && unit !== '1' ? `${number} ${unit}` : number;
}
