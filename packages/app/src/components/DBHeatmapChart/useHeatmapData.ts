import { useMemo, useState } from 'react';
import { inferTimestampColumn } from '@hyperdx/common-utils/dist/clickhouse';
import { convertDateRangeToGranularityString } from '@hyperdx/common-utils/dist/core/utils';

import { timeBucketByGranularity } from '@/ChartUtils';
import { useQueriedChartConfig } from '@/hooks/useChartConfig';

import { computeEffectiveMin, HEATMAP_N_BUCKETS } from './heatmapBounds';
import {
  EMPTY_HEATMAP_GRID,
  gridFromBucketRows,
  HeatmapGrid,
  HeatmapScaleType,
} from './heatmapGrid';
import {
  buildHeatmapBoundsConfig,
  buildHeatmapBucketConfig,
  HeatmapChartConfig,
} from './heatmapQueries';

export type HeatmapView = {
  grid: HeatmapGrid;
  generatedTsBuckets: Date[];
  effectiveMin: number;
  scaleType: HeatmapScaleType;
};

/**
 * Query a heatmap and shape it into a `HeatmapGrid`. While a refresh is in
 * flight, `view` stays on the last settled result.
 */
export function useHeatmapData({
  config,
  scaleType,
  enabled,
}: {
  config: HeatmapChartConfig;
  scaleType: HeatmapScaleType;
  enabled: boolean;
}) {
  const dateRange = config.dateRange;
  const granularity = convertDateRangeToGranularityString(dateRange, 245);

  const nBuckets = HEATMAP_N_BUCKETS;

  // Future: #1914 adds overflow-bucket indicators for smarter range
  // clamping without hiding spikes.
  const minMaxConfig = buildHeatmapBoundsConfig({ config, scaleType });

  const {
    data: minMaxData,
    isLoading: isMinMaxLoading,
    isPlaceholderData: isMinMaxPlaceholderData,
    error: minMaxError,
  } = useQueriedChartConfig(minMaxConfig, {
    queryKey: ['heatmap', minMaxConfig],
    enabled: enabled,
    placeholderData: prev => prev,
  });

  // UInt64 are returned as strings; quantile returns floats
  const min = Number.parseFloat(minMaxData?.data?.[0]?.['min'] ?? '0');
  const max = Number.parseFloat(minMaxData?.data?.[0]?.['max'] ?? '0');

  const effectiveMin = computeEffectiveMin(min, max, scaleType);

  const bucketConfig = buildHeatmapBucketConfig({
    config,
    scaleType,
    effectiveMin,
    max,
    granularity,
    nBuckets,
  });

  const canQueryBuckets =
    !!minMaxData && bucketConfig != null && max > effectiveMin;
  const { data, isLoading, isPlaceholderData, error } = useQueriedChartConfig(
    bucketConfig,
    {
      queryKey: ['heatmap_bucket', bucketConfig],
      // Wait for fresh bounds, so a refresh doesn't also query the new range
      // bucketed with the previous range's min/max.
      enabled: canQueryBuckets && !isMinMaxPlaceholderData,
      // Only keep the previous buckets while this query can still run, so an
      // empty refreshed range shows "Not enough data points" instead of
      // pulsing on stale buckets.
      placeholderData: canQueryBuckets ? prev => prev : undefined,
    },
  );
  // A refresh keeps the previous heatmap on screen and pulses until both
  // queries have fresh data.
  const isRefreshing = isMinMaxPlaceholderData || isPlaceholderData;

  // Memoize so timeBucketByGranularity's fresh Date[] doesn't defeat
  // the grid memoization downstream. dateRange itself may be a
  // fresh array each render, so depend on primitive ms + granularity.
  const fromMs = dateRange[0]?.getTime() ?? 0;
  const toMs = dateRange[1]?.getTime() ?? 0;
  const generatedTsBuckets = useMemo(
    () => timeBucketByGranularity(dateRange[0], dateRange[1], granularity),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [fromMs, toMs, granularity],
  );

  // A stable grid lets uplot-react skip its setData path when only
  // URL-state (xMin/xMax/yMin/yMax) changed. Pairs with the selectionBounds
  // prop on HeatmapPlot: the prop reapplies u.select on any chart
  // recreation, this memo prevents the recreation in the common case.
  const grid = useMemo<HeatmapGrid>(() => {
    const timestampColumn = inferTimestampColumn(data?.meta ?? []);
    if (data == null || data.data == null || timestampColumn == null)
      return EMPTY_HEATMAP_GRID;

    return gridFromBucketRows({
      data: data.data,
      timestampColumn,
      generatedTsBuckets,
      scaleType,
      effectiveMin,
      max,
      nBuckets,
    });
  }, [data, generatedTsBuckets, scaleType, effectiveMin, max, nBuckets]);

  // While refreshing, keep drawing the last settled heatmap. The previous
  // bucket rows only line up with the time buckets, bounds and scale they were
  // queried with, so re-plotting them on the new range would draw a blank or
  // mis-scaled grid.
  const currentView = useMemo<HeatmapView>(
    () => ({ grid, generatedTsBuckets, effectiveMin, scaleType }),
    [grid, generatedTsBuckets, effectiveMin, scaleType],
  );
  const [settledView, setSettledView] = useState(currentView);
  if (!isRefreshing && settledView !== currentView) {
    setSettledView(currentView);
  }
  const view = isRefreshing ? settledView : currentView;

  return {
    view,
    isLoading: isLoading || isMinMaxLoading,
    isRefreshing,
    error: error || minMaxError,
  };
}
