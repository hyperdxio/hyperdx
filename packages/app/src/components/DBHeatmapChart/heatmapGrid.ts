import {
  type HeatmapGrid,
  heatmapRowCount,
  type HeatmapYAxis,
} from '@hyperdx/common-utils/dist/core/heatmap';

export {
  gridFromBucketRows,
  type HeatmapGrid,
  heatmapRowCount,
  type HeatmapScaleType,
  type HeatmapYAxis,
} from '@hyperdx/common-utils/dist/core/heatmap';

/**
 * Numeric- and bucket-axis cells are counts, empty at 0. Series-axis cells
 * are values that may be zero or negative, empty when NaN.
 */
export type HeatmapCellKind = 'count' | 'value';

export function heatmapCellKind(yAxis: HeatmapYAxis): HeatmapCellKind {
  return yAxis.type === 'series' ? 'value' : 'count';
}

export function isEmptyHeatmapCell(value: number, kind: HeatmapCellKind) {
  return kind === 'value' ? !Number.isFinite(value) : !(value > 0);
}

export const EMPTY_HEATMAP_GRID: HeatmapGrid = {
  times: [],
  stepMs: 0,
  yAxis: { type: 'numeric', scale: 'linear', edges: [] },
  cells: [],
};

/**
 * Lower and upper bound of each row in plot space. Series and histogram
 * bucket rows are unit-height bands. The uPlot y scale is linear, so log-scale
 * rows are plotted in natural-log space and tick labels are exponentiated back.
 */
export function rowPlotBounds(yAxis: HeatmapYAxis): {
  lo: number[];
  hi: number[];
} {
  const rows = heatmapRowCount(yAxis);
  if (yAxis.type !== 'numeric') {
    return {
      lo: Array.from({ length: rows }, (_, r) => r),
      hi: Array.from({ length: rows }, (_, r) => r + 1),
    };
  }

  const toPlot = yAxis.scale === 'log' ? Math.log : (v: number) => v;
  const lo = yAxis.edges.slice(0, rows).map(toPlot);
  const hi = yAxis.edges.slice(1, rows + 1).map(toPlot);
  return { lo, hi };
}

/**
 * uPlot mode-2 data: `[xs, ys, cells]` are the facet values (cell centers)
 * and counts that uPlot reads; the remaining arrays carry each cell's extent
 * for the painter and tooltip. All y values are in plot space.
 */
export type HeatmapPlotData = [
  xs: number[],
  ys: number[],
  cells: number[],
  x0s: number[],
  x1s: number[],
  y0s: number[],
  y1s: number[],
];

export function gridToPlotData(grid: HeatmapGrid): HeatmapPlotData {
  const rows = heatmapRowCount(grid.yAxis);
  const { lo, hi } = rowPlotBounds(grid.yAxis);
  const halfStep = grid.stepMs / 2;

  const xs: number[] = [];
  const ys: number[] = [];
  const x0s: number[] = [];
  const x1s: number[] = [];
  const y0s: number[] = [];
  const y1s: number[] = [];
  for (const t of grid.times) {
    for (let r = 0; r < rows; r++) {
      xs.push(t);
      ys.push((lo[r] + hi[r]) / 2);
      x0s.push(t - halfStep);
      x1s.push(t + halfStep);
      y0s.push(lo[r]);
      y1s.push(hi[r]);
    }
  }
  return [xs, ys, grid.cells, x0s, x1s, y0s, y1s];
}

/**
 * Cumulative share (0-100) of events at or below each row, keyed by row
 * index and pooled across all time buckets.
 */
export function computeBucketPercentiles(
  grid: HeatmapGrid,
): Map<number, number> {
  const rows = heatmapRowCount(grid.yAxis);
  const rowTotals = new Array<number>(rows).fill(0);
  let total = 0;
  for (let i = 0; i < grid.cells.length; i++) {
    rowTotals[i % rows] += grid.cells[i];
    total += grid.cells[i];
  }

  const percentiles = new Map<number, number>();
  if (total === 0) {
    return percentiles;
  }

  let cumulative = 0;
  rowTotals.forEach((rowTotal, r) => {
    cumulative += rowTotal;
    percentiles.set(r, (cumulative / total) * 100);
  });

  return percentiles;
}
