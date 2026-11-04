import { convertGranularityToSeconds } from '@hyperdx/common-utils/dist/core/utils';
import { Exemplar } from '@hyperdx/common-utils/dist/types';

/** An exemplar plus the on-screen position of its marker, for the hover card. */
export type PositionedExemplar = { exemplar: Exemplar; x: number; y: number };

/** A single exemplar plotted on the chart: x in chart time units, y = value. */
type ExemplarPoint = {
  x: number;
  y: number;
  exemplar: Exemplar;
  key: string;
};

function finiteOrNull(v: unknown): number | null {
  // Finite, not merely non-NaN: a single Infinity would otherwise reach
  // standardDeviation, make the spread NaN, and silently switch the 2σ rule off
  // for the whole chart (`spread > 0` is false for NaN).
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/** Sample standard deviation, 0 when there isn't enough data to have one. */
function standardDeviation(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance =
    values.reduce((acc, v) => acc + (v - mean) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

/**
 * Turn raw exemplars into plotted points, thinned to keep the chart legible.
 *
 * - `maxExemplars <= 0`: no thinning — every exemplar is a point (deduped by
 *   trace id + timestamp).
 * - `maxExemplars > 0`: bucket at the chart granularity, per series
 *   (`groupKey`), then within each bucket keep the highest value plus any
 *   further value that sits more than 2σ below the last one kept (σ measured
 *   across the whole set). A busy bucket therefore contributes both a typical
 *   trace and its outlier, while a quiet one contributes a single marker —
 *   the overlay reads as the latency distribution rather than as a max
 *   envelope. If that leaves more buckets than the marker budget, the range is
 *   split into evenly spaced windows and the highest bucket in each survives —
 *   markers stay spread across the range *and* land on its peaks, where a
 *   globally value-ranked cut would bunch them all on one spike.
 *
 * Bucketing at the chart's own granularity (rather than a width derived from
 * the marker budget) keeps a marker inside the bucket of the series point it
 * explains. Same approach as Grafana's StandardDeviationSampler.
 *
 * Pure and side-effect free so the thinning behaviour can be unit-tested without
 * a recharts render.
 */
export function computeExemplarPoints(
  exemplars: Exemplar[] | undefined,
  opts: {
    maxExemplars: number;
    granularity: string;
  },
): ExemplarPoint[] {
  if (!exemplars?.length) return [];
  const { granularity } = opts;
  // The budget arrives from a team setting. Floor it to a whole number of
  // markers, and treat a non-finite value as unlimited rather than as zero: a
  // fractional value below 1 (or NaN) would otherwise make the window split
  // produce no windows and empty the overlay even though exemplars exist.
  const maxExemplars = !Number.isFinite(opts.maxExemplars)
    ? 0
    : opts.maxExemplars <= 0
      ? 0
      : Math.max(1, Math.floor(opts.maxExemplars));

  const toPoint = (exemplar: Exemplar, value: number): ExemplarPoint => ({
    x: exemplar.timestamp / 1000, // ms -> seconds (chart x unit)
    y: value,
    exemplar,
    key: `exemplar-${exemplar.traceId}-${exemplar.timestamp}`,
  });

  const points: ExemplarPoint[] = [];
  for (const exemplar of exemplars) {
    const value = finiteOrNull(exemplar.value);
    // `timestamp` needs the same guard as `value`: it feeds both the bucket key
    // and the x coordinate, so a non-finite one collapses every affected exemplar
    // into a single `@NaN` bucket and reaches recharts as a NaN x. The normalizers
    // parse through ExemplarSchema (`.finite()`) so this shouldn't fire in the
    // app, but this function is the pure, independently-tested boundary.
    if (value != null && finiteOrNull(exemplar.timestamp) != null) {
      points.push(toPoint(exemplar, value));
    }
  }
  if (!points.length) return [];

  if (maxExemplars <= 0) {
    const all = new Map<string, ExemplarPoint>();
    for (const p of points) all.set(p.key, p); // dedupe identical trace+time
    return Array.from(all.values());
  }

  const bucketMs = convertGranularityToSeconds(granularity) * 1000 || 1;
  const buckets = new Map<
    string,
    { bucket: number; max: number; points: ExemplarPoint[] }
  >();
  for (const p of points) {
    const bucket = Math.floor(p.exemplar.timestamp / bucketMs);
    const key = `${p.exemplar.groupKey ?? ''}@${bucket}`;
    const existing = buckets.get(key);
    if (existing) {
      existing.points.push(p);
      existing.max = Math.max(existing.max, p.y);
    } else {
      buckets.set(key, { bucket, max: p.y, points: [p] });
    }
  }

  // More buckets than the budget allows: split them into evenly spaced windows
  // and keep the most notable bucket in each. Coverage still spans the range,
  // but the surviving markers land on the peaks — an even stride is blind to
  // where the spikes are and skips straight past the marker you wanted.
  //
  // Take fewer windows than the budget so the leftover slots can hold the 2σ
  // companions below. Filling one window per slot would exhaust the budget on
  // rank 0 and the spread sampling would never render a second marker — the max
  // envelope this function exists to avoid.
  //
  // Two different thresholds, which is the point. The split only happens when the
  // buckets genuinely outnumber the budget; gating it on windowCount instead meant
  // 12 populated buckets at the default budget of 12 rendered 9 markers and left
  // three buckets bare, which is not "more buckets than the marker budget".
  const windowCount = Math.max(1, Math.ceil(maxExemplars * 0.75));
  const ordered = Array.from(buckets.values()).sort(
    (a, b) => a.bucket - b.bucket,
  );
  const chosen =
    ordered.length <= maxExemplars
      ? ordered
      : Array.from({ length: windowCount }, (_, i) =>
          ordered
            .slice(
              Math.floor((i * ordered.length) / windowCount),
              Math.floor(((i + 1) * ordered.length) / windowCount),
            )
            // >= so ties resolve to the *later* bucket: on a flat series every
            // bucket max is equal, and preferring the earlier one would leave
            // the right-hand edge of the chart bare.
            .reduce((best, b) => (b.max >= best.max ? b : best)),
        );

  const spread = standardDeviation(points.map(p => p.y)) * 2;
  const sampled = chosen.map(({ points: inBucket }) => {
    const byValue = [...inBucket].sort((a, b) => b.y - a.y);
    const kept = [byValue[0]];
    for (const p of byValue.slice(1)) {
      if (spread > 0 && kept[kept.length - 1].y - p.y > spread) kept.push(p);
    }
    return kept;
  });

  // Round-robin by rank so every surviving bucket gets its most notable marker
  // before any bucket gets a second one.
  const out: ExemplarPoint[] = [];
  for (let rank = 0; out.length < maxExemplars; rank++) {
    let placed = false;
    for (const kept of sampled) {
      if (rank >= kept.length) continue;
      out.push(kept[rank]);
      placed = true;
      if (out.length >= maxExemplars) break;
    }
    if (!placed) break;
  }
  return out;
}

/** The y range an exemplar marker may be drawn in. */
export type ExemplarYBounds = { min: number; max: number };

/**
 * Derive the y range a marker may be drawn in, from the domain the chart actually
 * renders. A recharts `ReferenceDot` defaults to `ifOverflow="discard"`, so a
 * marker outside the domain vanishes with no explanation.
 *
 * The two bounds are used differently by clampExemplarY, which is where the
 * reasoning lives: `max` is a ceiling markers are pinned to, `min` is a threshold
 * below which they are dropped. `min` is NOT a lift target — raising a fast
 * request to a fitted floor would draw it level with the slowest ones.
 *
 * Note `min` goes numeric on more than "Fit Y Axis to Data": useChartScales also
 * fits the floor whenever a legend selection is active, so isolating one series
 * can start dropping below-floor markers too.
 *
 * `'auto'` bounds are resolved by recharts against the series data, so the
 * series max is in-domain by construction and 0 is a safe floor for the
 * non-negative durations exemplars are scoped to today.
 */
export function computeExemplarYBounds(
  yAxisDomain: unknown,
  visibleSeriesMax: number,
): ExemplarYBounds {
  const [lower, upper] = Array.isArray(yAxisDomain)
    ? yAxisDomain
    : [undefined, undefined];
  return {
    min: typeof lower === 'number' ? lower : 0,
    max: typeof upper === 'number' ? upper : visibleSeriesMax,
  };
}

/**
 * Place an exemplar's value inside `bounds` so recharts keeps drawing it, or
 * return null to drop it.
 *
 * The two directions are not equivalent, so they are handled differently.
 *
 * Above `max`: pinned to the top. An outlier can be many times the plotted
 * quantile, and letting it set the axis would flatten the series into a line at
 * the bottom. A marker at the ceiling reads as "at least this high", and the
 * hover card carries the real number.
 *
 * Below `min`: dropped. With `fitYAxisToData` the floor is the data's own
 * minimum, so it can sit well above a fast request — and raising that marker to
 * the floor would draw it level with the slowest points, saying the opposite of
 * the truth. There is no honest position for it on this axis, so it is not drawn.
 *
 * Degenerate bounds (no numeric data yet, or inverted) leave the value untouched.
 */
export function clampExemplarY(
  y: number,
  bounds: ExemplarYBounds,
): number | null {
  const { min, max } = bounds;
  if (!Number.isFinite(max) || !Number.isFinite(min) || min > max) return y;
  if (y < min) return null;
  return Math.min(y, max);
}

/**
 * Place an exemplar's x (chart time units) inside the rendered x-domain, or
 * return null to drop it.
 *
 * `ReferenceDot` defaults to `ifOverflow="discard"`, so a marker outside the
 * domain silently vanishes. That loses the newest window: when
 * `dateRangeEndInclusive` is false the domain's upper bound is the *last bucket
 * start*, so an exemplar occurring inside that final bucket sits past the bound
 * and disappears — the window a live investigation is watching. Nudging it onto
 * the boundary of the bucket whose series point it explains fixes that.
 *
 * But only within one bucket. Anything further out is not an edge case, it is a
 * marker that belongs to a different window: `placeholderData` deliberately keeps
 * the previous range's exemplars across a range change, so a zoom hands this
 * function markers from the old, wider window. Pulling those to the axis edge
 * would draw real, clickable traces on buckets they did not occur in, with
 * nothing on screen saying so. Dropping them is the honest answer — the overlay
 * refills when the new range's query lands.
 *
 * `bucketSeconds` is the tolerance, in the chart's own time units. Degenerate or
 * inverted domains leave x untouched.
 */
export function clampExemplarX(
  x: number,
  domain: [number, number],
  bucketSeconds: number,
): number | null {
  const [min, max] = domain;
  if (!Number.isFinite(min) || !Number.isFinite(max) || min > max) return x;
  const tolerance = Number.isFinite(bucketSeconds)
    ? Math.max(0, bucketSeconds)
    : 0;
  if (x < min - tolerance || x > max + tolerance) return null;
  return Math.min(Math.max(x, min), max);
}
