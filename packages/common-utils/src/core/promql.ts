const PROMQL_GRANULARITY_SECONDS: Map<string, number> = new Map([
  ['15 second', 15],
  ['30 second', 30],
  ['1 minute', 60],
  ['5 minute', 300],
  ['10 minute', 600],
  ['15 minute', 900],
  ['30 minute', 1800],
  ['1 hour', 3600],
  ['2 hour', 7200],
  ['6 hour', 21600],
  ['12 hour', 43200],
  ['1 day', 86400],
]);

/** A HyperDX granularity ("5 minute") as a Prometheus step ("300s"). */
export const promqlStep = (granularity: string | undefined): string => {
  if (!granularity || granularity === 'auto') return '60s';
  return `${PROMQL_GRANULARITY_SECONDS.get(granularity) ?? 60}s`;
};
