import type { HeatmapScaleType } from './heatmapGrid';

export const HEATMAP_N_BUCKETS = 80;

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
