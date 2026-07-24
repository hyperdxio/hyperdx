import { convertGranularityToSeconds } from '@hyperdx/common-utils/dist/core/utils';
import { Exemplar } from '@hyperdx/common-utils/dist/types';

/** A single exemplar plotted on the chart: x in chart time units, y = value. */
type ExemplarPoint = {
  x: number;
  y: number;
  exemplar: Exemplar;
  key: string;
};

function finiteOrNull(v: unknown): number | null {
  return typeof v === 'number' && !isNaN(v) ? v : null;
}

/**
 * Turn raw exemplars into plotted points, thinned to keep the chart legible.
 *
 * - `maxExemplars <= 0`: no thinning — every exemplar is a point (deduped by
 *   trace id + timestamp).
 * - `maxExemplars > 0`: keep the single highest-value exemplar per time bucket
 *   per series (`groupKey`), where the bucket width is the larger of the chart
 *   granularity and `range / maxExemplars`. This caps marker count while
 *   surfacing the most notable trace in each window.
 *
 * Pure and side-effect free so the thinning behaviour can be unit-tested without
 * a recharts render.
 */
export function computeExemplarPoints(
  exemplars: Exemplar[] | undefined,
  opts: {
    maxExemplars: number;
    granularity: string;
    dateRange: [Date, Date] | Readonly<[Date, Date]>;
  },
): ExemplarPoint[] {
  if (!exemplars?.length) return [];
  const { maxExemplars, granularity, dateRange } = opts;

  const toPoint = (exemplar: Exemplar, value: number): ExemplarPoint => ({
    x: exemplar.timestamp / 1000, // ms -> seconds (chart x unit)
    y: value,
    exemplar,
    key: `exemplar-${exemplar.traceId}-${exemplar.timestamp}`,
  });

  if (maxExemplars <= 0) {
    const all = new Map<string, ExemplarPoint>();
    for (const exemplar of exemplars) {
      const value = finiteOrNull(exemplar.value);
      if (value == null) continue;
      const p = toPoint(exemplar, value);
      all.set(p.key, p); // dedupe identical trace+time
    }
    return Array.from(all.values());
  }

  const granMs = convertGranularityToSeconds(granularity) * 1000;
  const rangeMs = dateRange[1].getTime() - dateRange[0].getTime();
  const bucketMs = Math.max(
    granMs || 1,
    rangeMs > 0 ? Math.floor(rangeMs / maxExemplars) : granMs || 1,
  );

  const bestPerBucket = new Map<string, ExemplarPoint>();
  for (const exemplar of exemplars) {
    const value = finiteOrNull(exemplar.value);
    if (value == null) continue;
    const bucket = Math.floor(exemplar.timestamp / bucketMs);
    const key = `${exemplar.groupKey ?? ''}@${bucket}`;
    const existing = bestPerBucket.get(key);
    if (!existing || value > existing.y) {
      bestPerBucket.set(key, toPoint(exemplar, value));
    }
  }
  return Array.from(bestPerBucket.values());
}
