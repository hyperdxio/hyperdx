import * as chrono from 'chrono-node';

function normalizeParsedDate(parsed?: chrono.ParsedComponents): Date | null {
  if (!parsed) {
    return null;
  }

  if (parsed.isCertain('year')) {
    return parsed.date();
  }

  const now = new Date();
  if (
    !(
      parsed.isCertain('hour') ||
      parsed.isCertain('minute') ||
      parsed.isCertain('second') ||
      parsed.isCertain('millisecond')
    )
  ) {
    // If all of the time components have been inferred, set the time components of now
    // to match the parsed time components. This ensures that the comparison later on uses
    // the same point in time when only worrying about dates.
    now.setHours(parsed.get('hour') || 0);
    now.setMinutes(parsed.get('minute') || 0);
    now.setSeconds(parsed.get('second') || 0);
    now.setMilliseconds(parsed.get('millisecond') || 0);
  }

  const parsedDate = parsed.date();
  if (parsedDate > now) {
    parsedDate.setFullYear(parsedDate.getFullYear() - 1);
  }
  return parsedDate;
}

export function parseTimeRangeInput(
  str: string,
  isUTC: boolean = false,
): [Date | null, Date | null] {
  const parsedTimeResults = chrono.parse(str, isUTC ? { timezone: 0 } : {});
  if (parsedTimeResults.length === 0) {
    return [null, null];
  }

  const parsedTimeResult =
    parsedTimeResults.length === 1
      ? parsedTimeResults[0]
      : parsedTimeResults[1];
  const start = normalizeParsedDate(parsedTimeResult.start);
  const end = normalizeParsedDate(parsedTimeResult.end) || new Date();
  if (end && start && end < start) {
    // For date range strings that omit years, the chrono parser will infer the year
    // using the current year. This can cause the start date to be in the future, and
    // returned as the end date instead of the start date. After normalizing the dates,
    // we then need to swap the order to maintain a range from older to newer.
    return [end, start];
  } else {
    return [start, end];
  }
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
  const parsed = chrono.casual.parse(input)[0];
  return normalizeParsedDate(parsed?.start);
};
