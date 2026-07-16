// Shared maxVal used to position events across the waterfall and the minimap.
// Adds 10% right padding so the last span never touches the edge. Kept here so
// TimelineChart and TimelineMinimap derive an identical timeline range.
export function getMaxEventValue(
  rows: { events: { end: number }[] }[],
): number {
  let max = 0;
  for (const row of rows) {
    for (const event of row.events) {
      max = Math.max(max, event.end);
    }
  }
  return max * 1.1;
}

// Number of decimal places needed to render values spaced `step` apart without
// two adjacent ticks collapsing to the same rounded label. `step` is the tick
// interval expressed in the same unit the label is rendered in (µs, ms, or s).
// Intervals are always 1/2/5 × 10ⁿ buckets, so this is simply the number of
// fractional digits the interval requires (0.5 → 1, 0.05 → 2, 2 → 0, …).
function decimalsForStep(step: number): number {
  if (!Number.isFinite(step) || step <= 0) {
    return 0;
  }
  // A small epsilon guards against float noise where e.g. log10(0.001) lands
  // just below an integer (−3.0000000000000004) and would floor one too far.
  return Math.max(0, -Math.floor(Math.log10(step) + 1e-9));
}

/**
 * Formats the given millisecond duration in an appropriate unit (µs, ms, or s).
 *
 * When `step` is provided, precision is added so that (ms - step) and (ms + step)
 * are formatted as different strings. When `step` is not provided, the value is
 * is rounded to the nearest integer and formatted without decimals.
 *
 * @param ms The millisecond value to format.
 * @param step Optional tick interval, representing the number of milliseconds between adjacent values.
 * @returns the formatted string representation.
 */
export function renderMs(ms: number, step?: number) {
  if (ms < 1) {
    const µs = ms * 1000;
    const decimals = step != null ? decimalsForStep(step * 1000) : 0;
    const factor = Math.pow(10, decimals);

    // Only render as µs when it doesn't round up to a full millisecond.
    if (Math.round(µs * factor) / factor !== 1000) {
      return `${µs.toFixed(decimals)}µs`;
    }
  }

  if (ms < 1000) {
    const decimals = step != null ? decimalsForStep(step) : 0;
    return `${ms.toFixed(decimals)}ms`;
  }

  const s = ms / 1000;
  const decimals =
    step != null ? decimalsForStep(step / 1000) : ms % 1000 === 0 ? 0 : 3;
  return `${s.toFixed(decimals)}s`;
}

// Returns the smallest "human-friendly" interval (a 1/2/5 × 10ⁿ bucket) that
// divides `value` into at most `maxTicks` steps. Snapping up rather than down
// guarantees the resulting tick count never exceeds maxTicks, so callers can
// budget ticks by the available pixel width to avoid overlapping labels.
export function calculateInterval(value: number, maxTicks = 10) {
  if (value <= 0 || maxTicks < 1) {
    return value > 0 ? value : 1;
  }

  // The finest interval that would still fit within the tick budget; snap it up
  // to the nearest human-friendly bucket.
  const rough = value / maxTicks;
  const magnitude = Math.pow(10, Math.floor(Math.log10(rough)));

  if (rough <= magnitude) {
    return magnitude;
  }
  if (rough <= 2 * magnitude) {
    return 2 * magnitude;
  }
  if (rough <= 5 * magnitude) {
    return 5 * magnitude;
  }
  return 10 * magnitude;
}
