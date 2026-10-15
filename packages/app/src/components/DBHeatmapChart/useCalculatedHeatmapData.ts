import { useMemo } from 'react';
import { PromqlConfigWithDateRange } from '@hyperdx/common-utils/dist/types';

import { gridFromSamples } from './heatmapCalculate';
import { HeatmapScaleType } from './heatmapGrid';
import { HeatmapData, HeatmapView, useSettledView } from './useHeatmapView';
import { useHeatmapSeriesPoints } from './useSeriesHeatmapData';

/**
 * Query a calculated (PromQL distribution) heatmap: the same range query as a
 * series heatmap, with every series' samples bucketed client-side into a
 * value distribution per time column.
 */
export function useCalculatedHeatmapData({
  config,
  scaleType,
  enabled,
}: {
  config: PromqlConfigWithDateRange;
  scaleType: HeatmapScaleType;
  enabled: boolean;
}): HeatmapData {
  const { series, generatedTsBuckets, isLoading, isPlaceholderData, error } =
    useHeatmapSeriesPoints({
      config,
      enabled,
      // Every series counts towards the distribution, so none are dropped. This is a
      // client-side limit, so capping it wouldn't affect how much data is in memory.
      maxSeries: Number.POSITIVE_INFINITY,
    });

  const currentView = useMemo<HeatmapView>(() => {
    const { grid, effectiveMin } = gridFromSamples({
      series,
      times: generatedTsBuckets.map(d => d.getTime()),
      scaleType,
    });
    return {
      grid,
      generatedTsBuckets,
      scaleType,
      effectiveMin,
      hiddenSeriesCount: 0,
    };
  }, [series, generatedTsBuckets, scaleType]);

  return {
    view: useSettledView(currentView, isPlaceholderData),
    isLoading,
    isRefreshing: isPlaceholderData,
    error,
  };
}
