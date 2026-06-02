export function renderMs(ms: number) {
  if (ms < 1) {
    const µsRounded = Math.round(ms * 1000);

    if (µsRounded !== 1000) {
      return `${µsRounded}µs`;
    }
  }

  if (ms < 1000) {
    return `${Math.round(ms)}ms`;
  }

  if (ms % 1000 === 0) {
    return `${Math.floor(ms / 1000)}s`;
  }

  return `${(ms / 1000).toFixed(3)}s`;
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
