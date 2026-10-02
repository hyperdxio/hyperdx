import type uPlot from 'uplot';

import type { HeatmapScaleType } from './heatmapGrid';

/**
 * Drag-select bounds in data space: x in seconds (URL convention), y in
 * the y-axis's natural unit (NOT log-space; callers pass the actual value
 * users would expect to see, e.g. ms latency). yMin may be 0 when the
 * selection touched the bottom bucket; the renderer clamps to the chart's
 * visible y-axis floor.
 */
export type SelectionBounds = {
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
};

/**
 * Reapply a persisted selection rectangle to a uPlot instance. Called on
 * chart create and whenever the bounds prop changes; uPlot's `u.select`
 * is owned by the chart, so it gets wiped on any chart recreation. We use
 * the URL-backed bounds as the source of truth and mirror them onto the
 * chart imperatively. fireHook=false avoids re-entering the setSelect hook.
 */
export function applySelectionToChart(
  u: uPlot,
  bounds: SelectionBounds | null | undefined,
  scaleType: HeatmapScaleType,
) {
  // The clear path runs BEFORE the scale-not-populated guard below so a
  // null bounds always clears the rectangle, even on first paint when
  // u.scales.y is not yet populated. Keep this ordering when refactoring;
  // swapping it would suppress clears while scales are loading.
  if (bounds == null) {
    u.setSelect({ left: 0, top: 0, width: 0, height: 0 }, false);
    return;
  }

  const { xMin, xMax, yMin, yMax } = bounds;

  // x is in seconds in the URL; uPlot's x-axis is configured ms:1 so
  // values are stored as ms.
  const xMinPx = u.valToPos(xMin * 1000, 'x');
  const xMaxPx = u.valToPos(xMax * 1000, 'x');

  const yScaleMin = u.scales.y?.min;
  const yScaleMax = u.scales.y?.max;
  if (yScaleMin == null || yScaleMax == null) {
    return;
  }

  // For log scale, y-axis values are stored in log-space. Convert and
  // clamp to the visible axis: yMin may be 0 (bottom-bucket adjustment in
  // DBHeatmapChart's onFilter wrapper); yMax may exceed the axis.
  let yLowPlot: number;
  let yHighPlot: number;
  if (scaleType === 'log') {
    yHighPlot = yMax > 0 ? Math.min(Math.log(yMax), yScaleMax) : yScaleMax;
    yLowPlot = yMin > 0 ? Math.max(Math.log(yMin), yScaleMin) : yScaleMin;
  } else {
    yHighPlot = Math.min(yMax, yScaleMax);
    yLowPlot = Math.max(yMin, yScaleMin);
  }

  // uPlot's y-axis: high data values map to small pixel y (top of chart).
  const yHighPx = u.valToPos(yHighPlot, 'y');
  const yLowPx = u.valToPos(yLowPlot, 'y');

  const left = Math.min(xMinPx, xMaxPx);
  const right = Math.max(xMinPx, xMaxPx);

  u.setSelect(
    {
      left,
      top: yHighPx,
      width: right - left,
      height: Math.max(0, yLowPx - yHighPx),
    },
    false,
  );
}
