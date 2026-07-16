/**
 * Value scaling for terminal charts: width resampling (peak-preserving
 * for data, linear for timestamps) and "nice" y-axis tick generation.
 */

/**
 * Linearly resample a numeric series to exactly `targetLen` points.
 * Only suitable for values that are linear by construction (e.g. the
 * timestamp axis) — data series must go through {@link resampleSeries}
 * instead so peaks are preserved exactly.
 */
export function resampleLinear(values: number[], targetLen: number): number[] {
  if (values.length === 0 || targetLen <= 0) return [];
  if (values.length === 1) return new Array(targetLen).fill(values[0]);
  if (values.length === targetLen) return values;

  const out = new Array<number>(targetLen);
  const scale = (values.length - 1) / (targetLen - 1);
  for (let i = 0; i < targetLen; i++) {
    const pos = i * scale;
    const lo = Math.floor(pos);
    const hi = Math.min(values.length - 1, lo + 1);
    const frac = pos - lo;
    out[i] = values[lo] * (1 - frac) + values[hi] * frac;
  }
  return out;
}

/**
 * Resample a data series to exactly `targetLen` points, preserving
 * peaks — unlike plain linear resampling, which samples *between*
 * buckets and attenuates narrow spikes (a 0→1→0 spike would render as
 * ~0.94, and sub-row bumps vanish entirely).
 *
 * - Upsampling (buckets ≤ columns): every original value is placed
 *   exactly at its nearest column, and the columns in between are
 *   linearly interpolated.
 * - Downsampling: each column takes the max-magnitude value of the
 *   bucket range it covers, so spikes are never dropped.
 */
export function resampleSeries(values: number[], targetLen: number): number[] {
  if (values.length === 0 || targetLen <= 0) return [];
  if (values.length === 1) return new Array(targetLen).fill(values[0]);
  if (values.length === targetLen) return values;

  const out = new Array<number>(targetLen);

  if (values.length < targetLen) {
    // Upsample: pin each bucket to its nearest column, interpolate between
    const scale = (targetLen - 1) / (values.length - 1);
    let prevCol = 0;
    out[0] = values[0];
    for (let j = 1; j < values.length; j++) {
      const col = Math.round(j * scale);
      out[col] = values[j];
      const prevVal = values[j - 1];
      const span = col - prevCol;
      for (let c = prevCol + 1; c < col; c++) {
        const frac = (c - prevCol) / span;
        out[c] = prevVal * (1 - frac) + values[j] * frac;
      }
      prevCol = col;
    }
    return out;
  }

  // Downsample: keep the max-magnitude value in each column's bucket range
  for (let i = 0; i < targetLen; i++) {
    const start = Math.floor((i * values.length) / targetLen);
    const end = Math.max(
      start + 1,
      Math.floor(((i + 1) * values.length) / targetLen),
    );
    let extremum = values[start];
    for (let j = start + 1; j < end; j++) {
      if (Math.abs(values[j]) > Math.abs(extremum)) {
        extremum = values[j];
      }
    }
    out[i] = extremum;
  }
  return out;
}

export interface NiceAxis {
  niceMin: number;
  niceMax: number;
  /** Ascending tick values, niceMin..niceMax inclusive. Empty for flat data. */
  ticks: number[];
}

/** Round `x` to the nearest "nice" step: 1/2/2.5/5 ×10ⁿ. */
function niceNum(x: number): number {
  const exp = Math.floor(Math.log10(x));
  const frac = x / 10 ** exp;
  const nice =
    frac < 1.5 ? 1 : frac < 2.25 ? 2 : frac < 3.75 ? 2.5 : frac < 7.5 ? 5 : 10;
  return nice * 10 ** exp;
}

/**
 * Compute a "nice" y-axis domain and tick values (Graphics Gems nice
 * numbers, steps of 1/2/2.5/5 ×10ⁿ) — the same idea behind axis tick
 * generation in charting libraries like recharts: the axis is pinned at
 * zero (extended downward for negative data) and the top is rounded up
 * to a tick boundary, so labels read 0/5/10/…30 instead of raw
 * fractions of the data range like 21.73/19.92/…
 */
export function niceTicks(
  dataMin: number,
  dataMax: number,
  maxTicks = 5,
): NiceAxis {
  const lo = Math.min(0, dataMin);
  const hi = dataMax;
  if (!Number.isFinite(lo) || !Number.isFinite(hi) || hi <= lo) {
    return { niceMin: lo, niceMax: hi, ticks: [] };
  }
  const step = niceNum((hi - lo) / (maxTicks - 1));
  const clean = (v: number) => Number(v.toPrecision(12));
  const niceMin = clean(Math.floor(lo / step) * step);
  const niceMax = clean(Math.ceil(hi / step) * step);
  const count = Math.round((niceMax - niceMin) / step);
  const ticks = Array.from({ length: count + 1 }, (_, i) =>
    clean(niceMin + i * step),
  );
  return { niceMin, niceMax, ticks };
}
