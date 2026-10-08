import dynamic from 'next/dynamic';

import { HeatmapChartView, HeatmapChartViewProps } from './HeatmapChartView';
import type { HeatmapQuery } from './heatmapQueries';
import type { SelectionBounds } from './selection';
import { useCalculatedHeatmapData } from './useCalculatedHeatmapData';
import { useHeatmapData } from './useHeatmapData';
import { useHistogramHeatmapData } from './useHistogramHeatmapData';
import { useSeriesHeatmapData } from './useSeriesHeatmapData';

type DistributionQuery = Extract<HeatmapQuery, { mode: 'distribution' }>;
type CalculatedQuery = Extract<HeatmapQuery, { mode: 'calculated' }>;
type HistogramQuery = Extract<HeatmapQuery, { mode: 'histogram' }>;
type SeriesQuery = Extract<HeatmapQuery, { mode: 'series' }>;

type DistributionOnlyProps = {
  /** Drag-select on a distribution heatmap reports time and value bounds. */
  onFilter?: (xMin: number, xMax: number, yMin: number, yMax: number) => void;
  onClearFilter?: () => void;
  /**
   * The currently-applied drag-select bounds. When provided, the heatmap
   * draws the dashed selection rectangle and reapplies it after any uPlot
   * recreation (theme switch, prop change, resize) so the user always sees
   * which slice they filtered. Caller owns the URL/query-state plumbing;
   * this is purely a visual mirror of that state.
   */
  selectionBounds?: SelectionBounds | null;
};

type DBHeatmapChartProps = HeatmapChartViewProps &
  DistributionOnlyProps & {
    query: HeatmapQuery;
    enabled?: boolean;
  };

function DistributionHeatmapChart({
  query,
  enabled,
  onFilter,
  ...viewProps
}: HeatmapChartViewProps &
  DistributionOnlyProps & { query: DistributionQuery; enabled: boolean }) {
  const data = useHeatmapData({
    config: query.config,
    scaleType: query.scaleType,
    enabled,
  });
  const { view } = data;

  return (
    <HeatmapChartView
      {...viewProps}
      data={data}
      plotKey={JSON.stringify(query.config)}
      numberFormat={query.config.numberFormat}
      onFilter={
        onFilter
          ? (xMin, xMax, yMin, yMax) => {
              // In log mode, the bottom bucket collects all values
              // clamped by greatest(value, effectiveMin).  If the
              // selection touches that bucket, widen yMin to 0 so
              // the downstream SQL filter captures all those spans.
              // The 1.1x threshold adds 10% headroom to account for
              // floating-point rounding in the bucket boundary.
              const adjustedYMin =
                view.scaleType === 'log' && yMin <= view.effectiveMin * 1.1
                  ? 0
                  : yMin;
              onFilter(xMin, xMax, adjustedYMin, yMax);
            }
          : undefined
      }
    />
  );
}

function SeriesHeatmapChart({
  query,
  enabled,
  ...viewProps
}: HeatmapChartViewProps & { query: SeriesQuery; enabled: boolean }) {
  const data = useSeriesHeatmapData({
    config: query.config,
    enabled,
  });

  return (
    <HeatmapChartView
      {...viewProps}
      data={data}
      plotKey={JSON.stringify(query.config)}
      numberFormat={query.config.numberFormat}
    />
  );
}

function CalculatedHeatmapChart({
  query,
  enabled,
  ...viewProps
}: HeatmapChartViewProps & { query: CalculatedQuery; enabled: boolean }) {
  const data = useCalculatedHeatmapData({
    config: query.config,
    scaleType: query.scaleType,
    enabled,
  });

  return (
    <HeatmapChartView
      {...viewProps}
      data={data}
      plotKey={JSON.stringify(query.config)}
      numberFormat={query.config.numberFormat}
    />
  );
}

function HistogramHeatmapChart({
  query,
  enabled,
  ...viewProps
}: HeatmapChartViewProps & { query: HistogramQuery; enabled: boolean }) {
  const data = useHistogramHeatmapData({ config: query.config, enabled });

  return (
    <HeatmapChartView
      {...viewProps}
      data={data}
      plotKey={JSON.stringify(query.config)}
      numberFormat={query.config.numberFormat}
    />
  );
}

function DBHeatmapChart({
  query,
  enabled = true,
  onFilter,
  onClearFilter,
  selectionBounds,
  ...viewProps
}: DBHeatmapChartProps) {
  if (query.mode === 'series') {
    return (
      <SeriesHeatmapChart {...viewProps} query={query} enabled={enabled} />
    );
  }
  if (query.mode === 'calculated') {
    return (
      <CalculatedHeatmapChart {...viewProps} query={query} enabled={enabled} />
    );
  }
  if (query.mode === 'histogram') {
    return (
      <HistogramHeatmapChart {...viewProps} query={query} enabled={enabled} />
    );
  }
  return (
    <DistributionHeatmapChart
      {...viewProps}
      query={query}
      enabled={enabled}
      onFilter={onFilter}
      onClearFilter={onClearFilter}
      selectionBounds={selectionBounds}
    />
  );
}

export default dynamic(() => Promise.resolve(DBHeatmapChart), {
  ssr: false,
});
