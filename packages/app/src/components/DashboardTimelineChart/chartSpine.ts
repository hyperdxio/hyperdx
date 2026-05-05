import type { TimelineLane } from './types';

const MAX_BUCKETS = 60;
const MIN_BUCKETS = 8;
const TARGET_SECONDS_PER_BUCKET = 60;
/**
 * Tiny non-zero value emitted on the invisible Area series so that Recharts
 * has a real datapoint to bind tooltip activation to. Drives nothing visual.
 */
const HOVER_PROBE_VALUE = 0.01;

/**
 * Build a synthetic time-axis spine for the timeline chart.
 *
 * Recharts measures axes from the data array, not from explicit domain
 * settings alone. By emitting a sparse spine (≤ 60 evenly-spaced points
 * inside the date range) plus the actual event timestamps, we get:
 *   - A correctly drawn time axis when the lanes are empty.
 *   - Tooltip activation at any X position the user hovers.
 *   - No visual clutter: every spine point only carries the invisible
 *     `_hover` field.
 */
export function buildChartSpine(
  lanes: TimelineLane[],
  dateRange: [Date, Date],
): {
  data: { ts_bucket: number; _hover: number }[];
  xAxisDomain: [number, number];
} {
  const startSec = Math.floor(dateRange[0].getTime() / 1000);
  const endSec = Math.floor(dateRange[1].getTime() / 1000);
  const totalRange = Math.max(0, endSec - startSec);
  const bucketCount = Math.min(
    MAX_BUCKETS,
    Math.max(MIN_BUCKETS, Math.floor(totalRange / TARGET_SECONDS_PER_BUCKET)),
  );
  const step = Math.max(1, totalRange / bucketCount);

  const tsSet = new Set<number>();
  for (let t = startSec; t <= endSec; t += step) {
    tsSet.add(Math.floor(t));
  }
  for (const lane of lanes) {
    for (const event of lane.events) {
      tsSet.add(Math.floor(event.ts));
    }
  }

  const data = Array.from(tsSet)
    .sort((a, b) => a - b)
    .map(ts => ({ ts_bucket: ts, _hover: HOVER_PROBE_VALUE }));

  return {
    data,
    xAxisDomain: [startSec, endSec],
  };
}
