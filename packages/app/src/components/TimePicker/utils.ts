import * as chrono from 'chrono-node';
import ms from 'ms';

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

export const LIVE_TAIL_TIME_QUERY = 'Live Tail' as const;
export const LIVE_TAIL_DURATION_MS = ms('15m');

export const RELATIVE_TIME_OPTIONS: (
  | [label: string, duration: number, relativeSupport?: boolean]
  | 'divider'
)[] = [
  // ['Last 15 seconds', '15s'],
  // ['Last 30 seconds', '30s'],
  // 'divider',
  ['Last 1 minute', ms('1m'), true],
  ['Last 5 minutes', ms('5m'), true],
  ['Last 15 minutes', ms('15m'), true],
  ['Last 30 minutes', ms('30m'), true],
  ['Last 45 minutes', ms('45m'), true],
  'divider',
  ['Last 1 hour', ms('1h'), true],
  ['Last 3 hours', ms('3h')],
  ['Last 6 hours', ms('6h')],
  ['Last 12 hours', ms('12h')],
  'divider',
  ['Last 1 days', ms('1d')],
  ['Last 2 days', ms('2d')],
  ['Last 7 days', ms('7d')],
  ['Last 14 days', ms('14d')],
  ['Last 30 days', ms('30d')],
];

export function getRelativeTimeOptionLabel(value: number) {
  if (value === LIVE_TAIL_DURATION_MS) {
    return LIVE_TAIL_TIME_QUERY;
  }
  const option = RELATIVE_TIME_OPTIONS.find(
    option => option !== 'divider' && option[1] === value,
  ) as [string, number, boolean] | undefined;
  return option ? option[0] : undefined;
}

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
