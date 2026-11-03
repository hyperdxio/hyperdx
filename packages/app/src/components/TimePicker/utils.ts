import * as chrono from 'chrono-node';
import ms from 'ms';
import {
  formatDate,
  fromWallClock,
  toWallClock,
} from '@hyperdx/common-utils/dist/core/utils';

import { getLocalTimeZone } from '@/timeZone';

function currentDate(): Date {
  // eslint-disable-next-line no-restricted-syntax
  return new Date();
}

function resolveTimeZone(timeZone?: string): string {
  return timeZone ?? getLocalTimeZone();
}

// chrono reads text in one fixed offset. Using the zone's current offset makes
// words like "yesterday" resolve against today's date in that zone.
function chronoReference(timeZone: string): chrono.ParsingReference {
  const now = currentDate();
  const offsetMs = toWallClock(now, timeZone).getTime() - now.getTime();
  return { instant: now, timezone: offsetMs / 60_000 };
}

// The parsed date as a wall-clock date (see toWallClock). Readings without an
// offset are rebuilt from their fields instead of using chrono's fixed offset,
// so dates on the other side of a DST change get their own offset.
function parsedWallClock(
  parsed: chrono.ParsedComponents,
  timeZone: string,
): Date {
  if (parsed.isCertain('timezoneOffset')) {
    // An offset in the text ("10:00Z") or a time relative to now ("1h ago").
    return toWallClock(parsed.date(), timeZone);
  }
  return new Date(
    Date.UTC(
      parsed.get('year') ?? 0,
      (parsed.get('month') ?? 1) - 1,
      parsed.get('day') ?? 1,
      parsed.get('hour') ?? 0,
      parsed.get('minute') ?? 0,
      parsed.get('second') ?? 0,
      parsed.get('millisecond') ?? 0,
    ),
  );
}

// Compares wall-clock dates so the checks against "now" happen in the requested
// zone, but returns an instant. Instants that are already known (now, or text
// with an offset) are returned as-is: a clock reading in the hour repeated when
// clocks go back can't say which occurrence it is.
function normalizeParsedDate(
  parsed: chrono.ParsedComponents | undefined,
  timeZone: string,
): Date | null {
  if (!parsed) {
    return null;
  }

  const nowInstant = currentDate();
  const now = toWallClock(nowInstant, timeZone);
  const parsedDate = parsedWallClock(parsed, timeZone);
  let isExactNow = true;
  let isExactParsed = parsed.isCertain('timezoneOffset');

  // If all of the time components have been inferred, set the time components of now
  // to match the parsed time components. This ensures that the comparison later on uses
  // the same point in time when only worrying about dates.
  if (
    !(
      parsed.isCertain('hour') ||
      parsed.isCertain('minute') ||
      parsed.isCertain('second') ||
      parsed.isCertain('millisecond')
    )
  ) {
    now.setUTCHours(
      parsed.get('hour') || 0,
      parsed.get('minute') || 0,
      parsed.get('second') || 0,
      parsed.get('millisecond') || 0,
    );
    isExactNow = false;
  }

  // Handle future dates:
  // - If slightly in the future (within 1 day), clamp to now
  // - If significantly in the future (>1 day) AND year was inferred, shift year back
  //   (e.g., "Dec 25" typed in June defaults to Dec 25 this year, but user likely meant last Dec 25)
  if (parsedDate > now) {
    const oneDayFromNow = now.getTime() + ms('1d');
    if (parsedDate.getTime() <= oneDayFromNow) {
      // Slightly in the future: clamp to now
      return isExactNow ? nowInstant : fromWallClock(now, timeZone);
    } else if (!parsed.isCertain('year')) {
      // Significantly in the future with inferred year: shift year back
      parsedDate.setUTCFullYear(parsedDate.getUTCFullYear() - 1);
      isExactParsed = false;
    }
  }

  return isExactParsed ? parsed.date() : fromWallClock(parsedDate, timeZone);
}

// `timeZone` is an IANA name the text is read in; the local zone if omitted.
export function parseTimeRangeInput(
  str: string,
  timeZone?: string,
): [Date | null, Date | null] {
  const zone = resolveTimeZone(timeZone);
  const parsedTimeResults = chrono.parse(str, chronoReference(zone));
  if (parsedTimeResults.length === 0) {
    return [null, null];
  }

  const parsedTimeResult =
    parsedTimeResults.length === 1
      ? parsedTimeResults[0]
      : parsedTimeResults[1];
  const start = normalizeParsedDate(parsedTimeResult.start, zone);
  const end = normalizeParsedDate(parsedTimeResult.end, zone) ?? currentDate();
  if (start && end < start) {
    // For date range strings that omit years, the chrono parser will infer the year
    // using the current year. This can cause the start date to be in the future, and
    // returned as the end date instead of the start date. After normalizing the dates,
    // we then need to swap the order to maintain a range from older to newer.
    return [end, start];
  } else {
    return [start, end];
  }
}

// Range text without a year is re-parsed with an inferred year (the current
// one, or the previous one for dates >1 day ahead). Only past dates in the
// current year survive that, so every other range needs an explicit year.
export function rangeNeedsExplicitYear(
  range: readonly [Date, Date],
  timeZone?: string,
): boolean {
  const zone = resolveTimeZone(timeZone);
  const now = currentDate();
  const getYear = (d: Date) => toWallClock(d, zone).getUTCFullYear();
  return range.some(d => getYear(d) !== getYear(now) || d > now);
}

// Formats a range as text that parseTimeRangeInput maps back to the same dates.
// The year is only included when it's needed to do so, to keep the text short.
export function formatTimeRangeText(
  range: readonly [Date, Date],
  {
    timeZone,
    clock = '24h',
  }: { timeZone?: string; clock?: '12h' | '24h' } = {},
): string {
  const format = rangeNeedsExplicitYear(range, timeZone)
    ? 'withYear'
    : 'normal';
  return range.map(d => formatDate(d, { timeZone, format, clock })).join(' - ');
}

// Duration of a time range input in seconds, or null if it doesn't parse.
export function timeRangeInputToSeconds(
  str: string,
  timeZone?: string,
): number | null {
  const [start, end] = parseTimeRangeInput(str, timeZone);
  if (start == null || end == null) return null;
  return (end.getTime() - start.getTime()) / 1000;
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
  ['Last 3 hours', ms('3h'), true],
  ['Last 6 hours', ms('6h'), true],
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

export const dateParser = (input?: string, timeZone?: string) => {
  if (!input) {
    return null;
  }
  const zone = resolveTimeZone(timeZone);
  const parsed = chrono.casual.parse(input, chronoReference(zone))[0];
  return normalizeParsedDate(parsed?.start, zone);
};

// Mantine DateInput values are clock readings like "2026-10-22 13:05:00",
// which the picker shows in `timeZone` rather than the local zone.
export function toDateInputValue(date: Date, timeZone?: string): string {
  return toWallClock(date, resolveTimeZone(timeZone))
    .toISOString()
    .slice(0, 19)
    .replace('T', ' ');
}

export function fromDateInputValue(
  value: string,
  timeZone?: string,
): Date | null {
  const [date, time = '00:00:00'] = value.split(' ');
  const wallClock = new Date(`${date}T${time}Z`);
  return Number.isNaN(wallClock.getTime())
    ? null
    : fromWallClock(wallClock, resolveTimeZone(timeZone));
}
