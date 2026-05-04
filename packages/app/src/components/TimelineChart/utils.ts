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

export function calculateInterval(value: number) {
  // Calculate the approximate interval by dividing the value by 10
  const interval = value / 10;

  // Round the interval to the nearest power of 10 to make it a human-friendly number
  const magnitude = Math.pow(10, Math.floor(Math.log10(interval)));

  // Adjust the interval to the nearest standard bucket size
  let bucketSize = magnitude;
  if (interval >= 2 * magnitude) {
    bucketSize = 2 * magnitude;
  }
  if (interval >= 5 * magnitude) {
    bucketSize = 5 * magnitude;
  }

  return bucketSize;
}
