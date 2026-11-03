import { ColumnMetaType } from '@hyperdx/common-utils/dist/clickhouse';

export type HeatmapScaleType = 'log' | 'linear';

export type HeatmapYAxis =
  | {
      type: 'numeric';
      scale: HeatmapScaleType;
      /** `rows + 1` ascending row boundaries in data space. Rows may be uneven. */
      edges: number[];
    }
  /**
   * Pre-bucketed histogram rows, drawn evenly. One ascending upper bound per
   * row; the top bound may be `Infinity` (a `+Inf` bucket).
   */
  | { type: 'buckets'; bounds: number[] }
  | { type: 'series'; labels: string[] };

/** Source-agnostic heatmap data: one column per time bucket, one row per y bucket or series. */
export type HeatmapGrid = {
  /** Column centers, ms ascending. */
  times: number[];
  /** Column width, ms. */
  stepMs: number;
  yAxis: HeatmapYAxis;
  /** Row-major: `cells[timeIdx * rowCount + rowIdx]`. */
  cells: number[];
};

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

export function heatmapRowCount(yAxis: HeatmapYAxis) {
  switch (yAxis.type) {
    case 'series':
      return yAxis.labels.length;
    case 'buckets':
      return yAxis.bounds.length;
    case 'numeric':
      return Math.max(0, yAxis.edges.length - 1);
  }
}

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
 * Grid for the rows of the server-side `widthBucket` query. widthBucket
 * returns buckets 0 (underflow) through nBuckets + 1 (overflow), so each time
 * bucket has nBuckets + 2 rows.
 */
export function gridFromBucketRows({
  data,
  timestampColumn,
  generatedTsBuckets,
  scaleType,
  effectiveMin,
  max,
  nBuckets,
}: {
  data: Record<string, any>[];
  timestampColumn: ColumnMetaType;
  generatedTsBuckets: Date[];
  scaleType: HeatmapScaleType;
  effectiveMin: number;
  max: number;
  nBuckets: number;
}): HeatmapGrid {
  const isLog = scaleType === 'log' && effectiveMin > 0 && max > effectiveMin;
  const bucketValue = (j: number) =>
    isLog
      ? effectiveMin * Math.pow(max / effectiveMin, j / nBuckets)
      : effectiveMin + j * ((max - effectiveMin) / nBuckets);

  // Row j is centered on bucketValue(j), which is the upper bound of
  // widthBucket's bucket j, so the row boundaries sit half a bucket either
  // side of it.
  const rows = nBuckets + 2;
  const edges = Array.from({ length: rows + 1 }, (_, k) =>
    bucketValue(k - 0.5),
  );

  const times = generatedTsBuckets.map(d => d.getTime());
  const cells: number[] = [];

  let dataIndex = 0;
  for (const generatedTs of times) {
    for (let j = 0; j < rows; j++) {
      const row = data[dataIndex];

      if (
        row != null &&
        new Date(row[timestampColumn.name]).getTime() == generatedTs &&
        row['x_bucket'] == j
      ) {
        cells.push(Number.parseInt(row['count'], 10)); // UInt64 returns as string

        // Skip duplicate buckets (from unmerged distributed table results)
        while (
          dataIndex < data.length &&
          new Date(data[dataIndex][timestampColumn.name]).getTime() ==
            generatedTs &&
          data[dataIndex]['x_bucket'] == j
        ) {
          dataIndex++;
        }
      } else {
        cells.push(0);
      }
    }
  }

  return {
    times,
    stepMs: times.length > 1 ? times[1] - times[0] : 0,
    yAxis: { type: 'numeric', scale: isLog ? 'log' : 'linear', edges },
    cells,
  };
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
