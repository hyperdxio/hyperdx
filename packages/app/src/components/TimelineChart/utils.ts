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

export function calculateInterval(value: number, maxTicks = 15) {
  const rough = value / maxTicks;
  const magnitude = Math.pow(10, Math.floor(Math.log10(rough)));

  const standards = [1, 2, 5, 10];
  for (const s of standards) {
    const candidate = s * magnitude;
    if (value / candidate <= maxTicks) {
      return candidate;
    }
  }

  return 10 * magnitude;
}
