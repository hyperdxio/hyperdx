const DEFAULT_LOOKBACK_MS = 24 * 60 * 60 * 1000;

/** Resolve the metric tools' time window; defaults to the last 24 hours. */
export function parseTimeRange(
  startTime?: string,
  endTime?: string,
): { error: string } | { startDate: Date; endDate: Date } {
  const endDate = endTime ? new Date(endTime) : new Date();
  const startDate = startTime
    ? new Date(startTime)
    : new Date(endDate.getTime() - DEFAULT_LOOKBACK_MS);
  if (isNaN(endDate.getTime()) || isNaN(startDate.getTime())) {
    return {
      error: 'Invalid startTime or endTime: must be valid ISO 8601 strings',
    };
  }
  if (startDate >= endDate) {
    return { error: 'endTime must be greater than startTime' };
  }
  return { startDate, endDate };
}
