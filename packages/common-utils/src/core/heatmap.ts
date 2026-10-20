import { z } from 'zod';

import type { ColumnMetaType } from '@/clickhouse';
import {
  convertDateRangeToGranularityString,
  convertGranularityToSeconds,
} from '@/core/utils';
import type { NumberFormat, PromqlHeatmapMode, SQLInterval } from '@/types';
import { SQLIntervalSchema } from '@/types';

/** A heatmap's mode; tiles saved before modes existed are distribution heatmaps. */
export function getHeatmapMode<M extends PromqlHeatmapMode>(config: {
  heatmap?: { mode?: M };
}): M | 'distribution' {
  return config.heatmap?.mode ?? 'distribution';
}

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
 * Quantile used for the y-axis lower bound. A quantile (rather than min)
 * keeps near-zero outliers from stretching the log axis. The upper bound
 * uses the actual max so that rare latency spikes stay visible; log scale
 * already compresses wide ranges.
 */
export function heatmapLowQuantile(scaleType: HeatmapScaleType) {
  return scaleType === 'log' ? 0.01 : 0.001;
}

/**
 * Lower bound actually used for bucketing. Log scale needs a positive
 * minimum (log(0) is undefined), and the range is capped to ~4 orders of
 * magnitude so the axis isn't dominated by a long empty tail of near-zero
 * outliers.
 */
export function computeEffectiveMin(
  min: number,
  max: number,
  scaleType: HeatmapScaleType,
) {
  return scaleType === 'log' ? Math.max(min, max * 1e-4 || 1e-4) : min;
}

function isLogBuckets(scaleType: HeatmapScaleType, min: number, max: number) {
  return scaleType === 'log' && min > 0 && max > min;
}

/** Upper bound of `widthBucket` bucket j (bucket 0 is the underflow). */
function bucketValueFn(
  scaleType: HeatmapScaleType,
  effectiveMin: number,
  max: number,
  nBuckets: number,
) {
  return isLogBuckets(scaleType, effectiveMin, max)
    ? (j: number) => effectiveMin * Math.pow(max / effectiveMin, j / nBuckets)
    : (j: number) => effectiveMin + j * ((max - effectiveMin) / nBuckets);
}

/**
 * The `nBuckets + 1` bounds `widthBucket` counted between: bucket j covers
 * [edges[j - 1], edges[j]). The grid's edges are display edges, half a bucket off.
 */
export function heatmapBucketEdges(
  scaleType: HeatmapScaleType,
  effectiveMin: number,
  max: number,
  nBuckets: number,
): number[] {
  const bucketValue = bucketValueFn(scaleType, effectiveMin, max, nBuckets);
  return Array.from({ length: nBuckets + 1 }, (_, j) => bucketValue(j));
}

/**
 * Row edges for drawing the `nBuckets + 2` rows: the bucket bounds, with the
 * under- and overflow rows each given one bucket's height.
 */
export function heatmapRowEdges(
  bucketEdges: number[],
  scaleType: HeatmapScaleType,
): number[] {
  const [first, second] = [bucketEdges[0]!, bucketEdges[1] ?? bucketEdges[0]!];
  const last = bucketEdges.at(-1)!;
  const beforeLast = bucketEdges.at(-2) ?? last;
  return scaleType === 'log' && first > 0
    ? [(first * first) / second, ...bucketEdges, (last * last) / beforeLast]
    : [first - (second - first), ...bucketEdges, last + (last - beforeLast)];
}

/**
 * A distribution heatmap as returned to agents and scripts: `counts[t][r]`,
 * where row 0 counts values below `valueEdges[0]`, row r counts
 * [valueEdges[r - 1], valueEdges[r]) and the last row values at or above the
 * last edge.
 */
export const HeatmapResultSchema = z.object({
  valueExpression: z.string(),
  scale: z.enum(['log', 'linear']),
  granularity: z.string(),
  // Typed but not re-validated: NumberFormatSchema drags every types.ts schema
  // into the Claude plugin's bundle, which then fails to load in Claude Code.
  numberFormat: z
    .custom<NumberFormat>(v => typeof v === 'object' && v !== null)
    .optional(),
  times: z.array(z.string()),
  valueEdges: z.array(z.number()),
  counts: z.array(z.array(z.number())),
});
export type HeatmapResult = z.infer<typeof HeatmapResultSchema>;

export function toHeatmapResult(
  heatmap: {
    grid: HeatmapGrid;
    scaleType: HeatmapScaleType;
    bucketEdges: number[];
  },
  context: Pick<
    HeatmapResult,
    'valueExpression' | 'granularity' | 'numberFormat'
  >,
): HeatmapResult {
  return {
    ...context,
    scale: heatmap.scaleType,
    times: heatmap.grid.times.map(t => new Date(t).toISOString()),
    valueEdges: heatmap.bucketEdges,
    counts: heatmapCountColumns(heatmap.grid),
  };
}

/** Cells as `[timeIdx][rowIdx]`. */
export function heatmapCountColumns(grid: HeatmapGrid): number[][] {
  const rows = heatmapRowCount(grid.yAxis);
  return grid.times.map((_, t) => grid.cells.slice(t * rows, (t + 1) * rows));
}

/**
 * A time bucket size for a heatmap outside the browser: the requested one when
 * it is supported and not so fine it floods the grid, else one sized for
 * `targetBuckets`, with a note saying why.
 */
export function resolveDistributionGranularity(
  granularity: string | undefined,
  dateRange: [Date, Date],
  targetBuckets: number,
): { granularity: SQLInterval; note?: string } {
  const auto = convertDateRangeToGranularityString(dateRange, targetBuckets);
  if (!granularity || granularity === 'auto') return { granularity: auto };
  if (!SQLIntervalSchema.safeParse(granularity).success) {
    return {
      granularity: auto,
      note: `Granularity "${granularity}" is not supported (use "<n> second|minute|hour|day"); used "${auto}".`,
    };
  }
  const seconds = convertGranularityToSeconds(granularity as SQLInterval);
  const buckets =
    (dateRange[1].getTime() - dateRange[0].getTime()) / 1000 / seconds;
  if (!(seconds > 0) || buckets > targetBuckets * 4) {
    return {
      granularity: auto,
      note: `Granularity "${granularity}" would make ${Math.round(buckets)} time buckets; used "${auto}".`,
    };
  }
  return { granularity: granularity as SQLInterval };
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
  const isLog = isLogBuckets(scaleType, effectiveMin, max);
  const bucketValue = bucketValueFn(scaleType, effectiveMin, max, nBuckets);

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
