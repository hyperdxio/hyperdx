import { useMemo } from 'react';
import { ResponseJSON } from '@hyperdx/common-utils/dist/clickhouse';
import { BuilderChartConfigWithDateRange } from '@hyperdx/common-utils/dist/types';

import { formatResponseForTimeChart } from '@/ChartUtils';
import { useQueriedChartConfig } from '@/hooks/useChartConfig';

import { buildHeatmapSeriesConfig } from './heatmapQueries';
import { gridFromSeries, HeatmapSeries } from './heatmapSeriesGrid';
import {
  HeatmapData,
  HeatmapView,
  useHeatmapTimeBuckets,
  useSettledView,
} from './useHeatmapView';

const HEATMAP_MAX_SERIES = 50;

/**
 * Group time-chart rows into one point list per series, keeping the
 * `HEATMAP_MAX_SERIES` series with the largest peaks.
 */
function responseToHeatmapSeries(
  response: ResponseJSON<Record<string, any>>,
  dateRange: [Date, Date],
): { series: HeatmapSeries[]; hiddenSeriesCount: number } {
  const { graphResults, timestampColumn, lineData, hiddenSeriesCount } =
    formatResponseForTimeChart({
      currentPeriodResponse: response,
      dateRange,
      generateEmptyBuckets: false,
      maxSeries: HEATMAP_MAX_SERIES,
    });

  const series = lineData.map(line => ({
    name: line.displayName,
    points: [] as HeatmapSeries['points'],
  }));
  for (const row of graphResults) {
    // graphResults timestamps are in seconds
    const t = (row[timestampColumn.name] ?? 0) * 1000;
    lineData.forEach((line, i) => {
      const v = row[line.dataKey];
      if (v != null) series[i].points.push({ t, v });
    });
  }
  return { series, hiddenSeriesCount };
}

/**
 * Query a series-mode heatmap. Queried like a time chart, formatting the
 * response into a heatmap grid with series on the y axis, time on the
 * x-axis, and value determining the cell value.
 */
export function useSeriesHeatmapData({
  config,
  enabled,
}: {
  config: BuilderChartConfigWithDateRange;
  enabled: boolean;
}): HeatmapData {
  const { granularity, generatedTsBuckets, fromMs, toMs } =
    useHeatmapTimeBuckets(config);

  const seriesConfig = buildHeatmapSeriesConfig(config, granularity);
  const { data, isLoading, isPlaceholderData, error } = useQueriedChartConfig(
    seriesConfig,
    {
      queryKey: ['heatmap_series', seriesConfig],
      enabled,
      placeholderData: prev => prev,
    },
  );

  // Depend on primitive number ms values so a fresh dateRange array doesn't
  // re-parse the response and rebuild the grid on every render.
  const parsed = useMemo<{
    series: HeatmapSeries[];
    hiddenSeriesCount: number;
    error?: Error;
  }>(() => {
    if (data == null) return { series: [], hiddenSeriesCount: 0 };
    try {
      return responseToHeatmapSeries(data, [new Date(fromMs), new Date(toMs)]);
    } catch (e) {
      return {
        series: [],
        hiddenSeriesCount: 0,
        error: e instanceof Error ? e : new Error(String(e)),
      };
    }
  }, [data, fromMs, toMs]);

  const currentView = useMemo<HeatmapView>(
    () => ({
      grid: gridFromSeries(
        parsed.series,
        generatedTsBuckets.map(d => d.getTime()),
      ),
      generatedTsBuckets,
      scaleType: 'linear',
      effectiveMin: 0,
      hiddenSeriesCount: parsed.hiddenSeriesCount,
    }),
    [parsed, generatedTsBuckets],
  );

  return {
    view: useSettledView(currentView, isPlaceholderData),
    isLoading,
    isRefreshing: isPlaceholderData,
    error: error ?? parsed.error,
  };
}
