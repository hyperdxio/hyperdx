import dynamic from 'next/dynamic';

import { HeatmapChartView, HeatmapChartViewProps } from './HeatmapChartView';
import type { HeatmapQuery } from './heatmapQueries';
import type { SelectionBounds } from './selection';
import { useHeatmapData } from './useHeatmapData';

type DBHeatmapChartProps = HeatmapChartViewProps & {
  query: HeatmapQuery;
  enabled?: boolean;
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

function DBHeatmapChart({
  query,
  enabled = true,
  onFilter,
  ...viewProps
}: DBHeatmapChartProps) {
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

export default dynamic(() => Promise.resolve(DBHeatmapChart), {
  ssr: false,
});
