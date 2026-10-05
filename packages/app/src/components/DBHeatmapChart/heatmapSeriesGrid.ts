import type { HeatmapGrid } from './heatmapGrid';

type HeatmapPoint = { t: number; v: number };
export type HeatmapSeries = { name: string; points: HeatmapPoint[] };

const naturalCompare = new Intl.Collator(undefined, { numeric: true }).compare;

/**
 * Index of the time column containing `t`, or -1. Server-side time buckets
 * normally match `times` exactly; the arithmetic fallback covers timestamps
 * that land inside a column instead of on its start.
 */
function makeTimeIndexer(times: number[], stepMs: number) {
  const indexByTime = new Map(times.map((t, i) => [t, i]));
  return (t: number) => {
    const exact = indexByTime.get(t);
    if (exact != null) return exact;
    if (stepMs <= 0 || times.length === 0) return -1;
    const i = Math.floor((t - times[0]) / stepMs);
    return i >= 0 && i < times.length ? i : -1;
  };
}

/**
 * One row per series, colored by value. Rows sort naturally by name with the
 * first name in the top row (row 0 is the bottom row).
 */
export function gridFromSeries(
  series: HeatmapSeries[],
  times: number[],
): HeatmapGrid {
  const sorted = [...series].sort((a, b) => naturalCompare(b.name, a.name));
  const stepMs = times.length > 1 ? times[1] - times[0] : 0;

  const rows = sorted.length;
  const timeIndex = makeTimeIndexer(times, stepMs);
  const cells = new Array<number>(times.length * rows).fill(0);
  sorted.forEach((s, r) => {
    for (const { t, v } of s.points) {
      const ti = timeIndex(t);
      if (ti < 0 || !Number.isFinite(v)) continue;
      cells[ti * rows + r] = v;
    }
  });

  return {
    times,
    stepMs,
    yAxis: { type: 'series', labels: sorted.map(s => s.name) },
    cells,
  };
}
