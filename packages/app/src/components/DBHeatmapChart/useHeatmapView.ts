import { useMemo, useState } from 'react';
import { ClickHouseQueryError } from '@hyperdx/common-utils/dist/clickhouse';
import { convertDateRangeToGranularityString } from '@hyperdx/common-utils/dist/core/utils';

import { timeBucketByGranularity } from '@/ChartUtils';

import type { HeatmapGrid, HeatmapScaleType } from './heatmapGrid';

export type HeatmapView = {
  grid: HeatmapGrid;
  generatedTsBuckets: Date[];
  /** The scale and lower bound the grid was bucketed with. */
  scaleType: HeatmapScaleType;
  effectiveMin: number;
};

/** What a heatmap data hook returns for the chart to render. */
export type HeatmapData = {
  view: HeatmapView;
  isLoading: boolean;
  isRefreshing: boolean;
  error: Error | ClickHouseQueryError | null | undefined;
};

/** The heatmap's time columns: bucket starts across the date range. */
export function useHeatmapTimeBuckets(dateRange: [Date, Date]) {
  const granularity = convertDateRangeToGranularityString(dateRange, 245);

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

  return { granularity, generatedTsBuckets, fromMs, toMs };
}

/**
 * While refreshing, keep drawing the last settled heatmap. The previous
 * query results only line up with the time buckets, bounds and scale they
 * were queried with, so re-plotting them on the new range would draw a blank
 * or mis-scaled grid.
 */
export function useSettledView(
  currentView: HeatmapView,
  isRefreshing: boolean,
) {
  const [settledView, setSettledView] = useState(currentView);
  if (!isRefreshing && settledView !== currentView) {
    setSettledView(currentView);
  }
  return isRefreshing ? settledView : currentView;
}
