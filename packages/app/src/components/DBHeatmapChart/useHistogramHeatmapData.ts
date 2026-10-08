import { useMemo } from 'react';
import { PromqlConfigWithDateRange } from '@hyperdx/common-utils/dist/types';

import { gridFromHistogramSamples, HistogramSample } from './heatmapHistogram';
import { HeatmapData, HeatmapView, useSettledView } from './useHeatmapView';
import { useHeatmapSeriesQuery } from './useSeriesHeatmapData';

/**
 * Query a histogram heatmap: a PromQL range query over histogram buckets,
 * drawn as one row per `le` bucket.
 */
export function useHistogramHeatmapData({
  config,
  enabled,
}: {
  config: PromqlConfigWithDateRange;
  enabled: boolean;
}): HeatmapData {
  const { generatedTsBuckets, data, isLoading, isPlaceholderData, error } =
    useHeatmapSeriesQuery({ config, enabled });

  const currentView = useMemo<HeatmapView>(() => {
    const samples: HistogramSample[] = (data?.data ?? []).map(row => ({
      le: String(row.le),
      t: new Date(row.__hdx_time_bucket).getTime(),
      v: Number(row.value),
    }));
    return {
      grid: gridFromHistogramSamples({
        samples,
        times: generatedTsBuckets.map(d => d.getTime()),
      }),
      generatedTsBuckets,
      scaleType: 'linear',
      effectiveMin: 0,
      hiddenSeriesCount: 0,
    };
  }, [data, generatedTsBuckets]);

  return {
    view: useSettledView(currentView, isPlaceholderData),
    isLoading,
    isRefreshing: isPlaceholderData,
    error,
  };
}
