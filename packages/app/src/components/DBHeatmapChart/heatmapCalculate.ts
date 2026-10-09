import { range, round } from 'lodash';

import { computeEffectiveMin, heatmapLowQuantile } from './heatmapBounds';
import {
  EMPTY_HEATMAP_GRID,
  HeatmapGrid,
  HeatmapScaleType,
} from './heatmapGrid';
import { HeatmapSeries, makeTimeIndexer } from './heatmapSeriesGrid';

export const CALCULATED_TARGET_BUCKETS = 10;

/** Decimal places required to represent multiples of the given nice y step */
function yStepDecimals(yStep: number) {
  return Math.max(0, 1 - Math.floor(Math.log10(yStep)));
}

const ALL_MULTS = [
  1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5, 5.5, 6, 6.5, 7, 7.5, 8, 8.5, 9, 9.5,
];

/**
 * ...0.01, 0.015, 0.02, ..., 0.95, 1, 2, 3, ..., 9, 10, 15, 20, ...
 *
 * Covers the full range of numbers representable in JavaScript floats.
 */
const NICE_Y_STEPS = range(-16, 308).flatMap(exp =>
  ALL_MULTS.map(m => round(m * 10 ** exp, yStepDecimals(m * 10 ** exp))).filter(
    yStep => exp < 0 || Number.isInteger(yStep),
  ),
);

/** The largest nice y step that splits `[min, max]` into at least `count` buckets. */
function niceYStep(min: number, max: number, count: number) {
  const approx = (max - min) / Math.max(count - 1, 1);
  const idx = NICE_Y_STEPS.findIndex(yStep => yStep > approx);
  if (idx === -1) return NICE_Y_STEPS[NICE_Y_STEPS.length - 1];
  return NICE_Y_STEPS[Math.max(idx - 1, 0)];
}

/** Index of the `yStep`-tall row holding `value`. */
function yStepIndex(value: number, yStep: number) {
  return Math.floor(round(value / yStep, 9));
}

/**
 * Linear buckets: at least `CALCULATED_TARGET_BUCKETS` rows of a nice y step,
 * aligned to multiples of the step so edges are round numbers.
 */
function linearBuckets(min: number, max: number) {
  // A constant value has no range to split, so size its single row by the
  // value's magnitude instead of the smallest step, which would be invisible.
  const yStep =
    max > min
      ? niceYStep(min, max, CALCULATED_TARGET_BUCKETS)
      : niceYStep(0, Math.abs(min) || 1, CALCULATED_TARGET_BUCKETS);
  const decimals = yStepDecimals(yStep);
  const minIdx = yStepIndex(min, yStep);
  const rows = yStepIndex(max, yStep) - minIdx + 1;
  const edges = Array.from({ length: rows + 1 }, (_, k) =>
    round((minIdx + k) * yStep, decimals),
  );

  return { edges, rowOf: (v: number) => yStepIndex(v, yStep) - minIdx };
}

/**
 * Log buckets over positive samples, bounded like a builder distribution
 * heatmap's: `CALCULATED_TARGET_BUCKETS` geometric rows from `effectiveMin`
 * to the max, with smaller values in the bottom row.
 */
function logBuckets(values: Float64Array) {
  const q = heatmapLowQuantile('log');
  const min = values[Math.floor(q * (values.length - 1))];
  const max = values[values.length - 1];
  let effectiveMin = computeEffectiveMin(min, max, 'log');
  if (!(max > effectiveMin)) {
    // The low quantile reaches the max when nearly every sample has the same
    // value; fall back to the smallest sample, then the range cap.
    effectiveMin = computeEffectiveMin(
      values[0] < max ? values[0] : 0,
      max,
      'log',
    );
  }
  if (!(max > effectiveMin)) return undefined;

  const n = CALCULATED_TARGET_BUCKETS;
  const logRange = Math.log(max / effectiveMin);
  const edges = Array.from(
    { length: n + 1 },
    (_, k) => effectiveMin * Math.pow(max / effectiveMin, k / n),
  );

  return {
    edges,
    rowOf: (v: number) =>
      Math.floor((n * Math.log(v / effectiveMin)) / logRange),
  };
}

/**
 * A distribution grid of every series' samples: each cell counts the samples
 * in a time column whose values fall in a row's bucket.
 */
export function gridFromSamples({
  series,
  times,
  scaleType,
}: {
  series: HeatmapSeries[];
  times: number[];
  scaleType: HeatmapScaleType;
}): { grid: HeatmapGrid; effectiveMin: number } {
  const stepMs = times.length > 1 ? times[1] - times[0] : 0;
  const timeIndex = makeTimeIndexer(times, stepMs);

  // Two passes over the points, one for the bounds and one to count, so no
  // per-sample copy is held between them.
  const forEachSample = (fn: (ti: number, v: number) => void) => {
    for (const s of series) {
      for (const { t, v } of s.points) {
        const ti = timeIndex(t);
        // Non-positive values have no log, so log buckets drop them
        if (ti < 0 || !Number.isFinite(v) || (scaleType === 'log' && v <= 0)) {
          continue;
        }
        fn(ti, v);
      }
    }
  };

  // Log bounds need a quantile, so they keep every value
  const values =
    scaleType === 'log'
      ? new Float64Array(series.reduce((n, s) => n + s.points.length, 0))
      : undefined;
  let count = 0;
  let min = Infinity;
  let max = -Infinity;
  forEachSample((_, v) => {
    if (values != null) values[count] = v;
    count++;
    min = Math.min(min, v);
    max = Math.max(max, v);
  });
  if (count === 0) {
    return { grid: EMPTY_HEATMAP_GRID, effectiveMin: 0 };
  }

  const buckets =
    values != null
      ? logBuckets(values.subarray(0, count).sort())
      : linearBuckets(min, max);
  if (buckets == null) {
    return { grid: EMPTY_HEATMAP_GRID, effectiveMin: 0 };
  }

  const rows = buckets.edges.length - 1;
  const cells = new Array<number>(times.length * rows).fill(0);
  forEachSample((ti, v) => {
    // Log values below the effective min fall in the bottom row, and the max
    // computes to one past the top row
    const r = Math.min(rows - 1, Math.max(0, buckets.rowOf(v)));
    cells[ti * rows + r]++;
  });

  return {
    grid: {
      times,
      stepMs,
      yAxis: { type: 'numeric', scale: scaleType, edges: buckets.edges },
      cells,
    },
    effectiveMin: buckets.edges[0],
  };
}
