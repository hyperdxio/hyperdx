import * as chrono from 'chrono-node';

export function parseTimeRangeInput(str: string): [Date | null, Date | null] {
  const parsedTimeResult = chrono.parse(str);
  const start =
    parsedTimeResult.length === 1
      ? parsedTimeResult[0].start?.date()
      : parsedTimeResult.length > 1
      ? parsedTimeResult[1].start?.date()
      : null;
  const end =
    parsedTimeResult.length === 1 && parsedTimeResult[0].end != null
      ? parsedTimeResult[0].end.date()
      : parsedTimeResult.length > 1 && parsedTimeResult[1].end != null
      ? parsedTimeResult[1].end.date()
      : start != null && start instanceof Date
      ? new Date()
      : null;

  return [start, end];
}

export const LIVE_TAIL_TIME_QUERY = 'Live Tail';

export const RELATIVE_TIME_OPTIONS: ([string, string] | 'divider')[] = [
  // ['Last 15 seconds', '15s'],
  // ['Last 30 seconds', '30s'],
  // 'divider',
  ['Last 1 minute', '1m'],
  ['Last 5 minutes', '5m'],
  ['Last 15 minutes', '15m'],
  ['Last 30 minutes', '30m'],
  ['Last 45 minutes', '45m'],
  'divider',
  ['Last 1 hour', '1h'],
  ['Last 3 hours', '3h'],
  ['Last 6 hours', '6h'],
  ['Last 12 hours', '12h'],
  'divider',
  ['Last 1 days', '1d'],
  ['Last 2 days', '2d'],
  ['Last 7 days', '7d'],
  ['Last 14 days', '14d'],
  ['Last 30 days', '30d'],
];

export const DURATION_OPTIONS = [
  '30s',
  '1m',
  '5m',
  '15m',
  '30m',
  '1h',
  '3h',
  '6h',
  '12h',
];

export const DURATIONS: Record<string, any> = {
  '30s': { seconds: 30 },
  '1m': { minutes: 1 },
  '5m': { minutes: 5 },
  '15m': { minutes: 15 },
  '30m': { minutes: 30 },
  '1h': { hours: 1 },
  '3h': { hours: 3 },
  '6h': { hours: 6 },
  '12h': { hours: 12 },
};

export const dateParser = (input?: string) => {
  if (!input) {
    return null;
  }
  return chrono.casual.parseDate(input);
};
