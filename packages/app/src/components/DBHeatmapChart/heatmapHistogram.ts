import { parsePromqlLe } from '@hyperdx/common-utils/dist/core/promql';

import type { HeatmapGrid } from './heatmapGrid';
import { makeTimeIndexer } from './heatmapSeriesGrid';

/** A sample of one histogram bucket: its `le` label, time (ms) and cumulative value. */
export type HistogramSample = { le: string; t: number; v: number };

/**
 * A grid with one row per `le` bucket, lowest bound at the bottom. Bucket
 * samples are cumulative (each counts everything at or below its bound), so a
 * cell is its bucket's value minus the next bucket down's.
 */
export function gridFromHistogramSamples({
  samples,
  times,
}: {
  samples: HistogramSample[];
  times: number[];
}): HeatmapGrid {
  const stepMs = times.length > 1 ? times[1] - times[0] : 0;
  const timeIndex = makeTimeIndexer(times, stepMs);

  // Keyed by numeric bound, since the same bound can be written differently
  // (Prometheus 3 normalizes le="1" to le="1.0"). Such series are summed.
  const bounds = [...new Set(samples.map(s => parsePromqlLe(s.le)))]
    .filter(bound => !Number.isNaN(bound))
    .sort((a, b) => a - b);
  const rowOf = new Map(bounds.map((bound, r) => [bound, r]));
  const rows = bounds.length;

  const cumulative = new Array<number>(times.length * rows).fill(NaN);
  for (const { le, t, v } of samples) {
    const ti = timeIndex(t);
    const r = rowOf.get(parsePromqlLe(le));
    if (ti < 0 || r == null || !Number.isFinite(v)) continue;
    const i = ti * rows + r;
    cumulative[i] = Number.isNaN(cumulative[i]) ? v : cumulative[i] + v;
  }

  const cells = new Array<number>(times.length * rows).fill(0);
  for (let ti = 0; ti < times.length; ti++) {
    let below = 0;
    for (let r = 0; r < rows; r++) {
      const cum = cumulative[ti * rows + r];
      if (Number.isNaN(cum)) continue;
      // rate() and increase() extrapolate each bucket separately, so adjacent
      // buckets can come out slightly non-monotonic.
      cells[ti * rows + r] = Math.max(0, cum - below);
      below = cum;
    }
  }

  return {
    times,
    stepMs,
    yAxis: { type: 'buckets', bounds },
    cells,
  };
}
