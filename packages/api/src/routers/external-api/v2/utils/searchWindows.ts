import { DEFAULT_TIME_WINDOWS_SECONDS } from '@hyperdx/common-utils/dist/core/searchWindows';
import {
  getFirstOrderingItem,
  isFirstOrderByAscending,
  isRoundedTimestampPart,
  parseToStartOfFunction,
  removeTrailingDirection,
  splitAndTrimWithBracket,
} from '@hyperdx/common-utils/dist/core/utils';

import type { CursorWindow } from './searchCursor';

// Windows keep the requested order only when the first sort key is the
// timestamp itself, not a derived key such as toHour(Timestamp). Stricter than
// isTimestampExpressionInFirstOrderBy, which accepts any key containing it.
function leadingTimestampPart(
  orderBy: string,
  timestampValueExpression: string | undefined,
): string | null {
  const first = getFirstOrderingItem(orderBy);
  if (typeof first !== 'string' || timestampValueExpression == null) {
    return null;
  }
  const expression = removeTrailingDirection(first);
  // A tuple order such as (TimestampTime, Timestamp) is led by its first element.
  const leading = /^\(.*\)$/s.test(expression)
    ? splitAndTrimWithBracket(expression.slice(1, -1))[0]
    : expression;
  return splitAndTrimWithBracket(timestampValueExpression).includes(leading)
    ? leading
    : null;
}

// toStartOf*, toDate and Date-typed parts get inclusive bounds on both ends.
async function isExactTimestampPart(
  part: string,
  columnType: (column: string) => Promise<string | undefined>,
): Promise<boolean> {
  if (isRoundedTimestampPart(part, undefined)) return false;
  return !isRoundedTimestampPart(part, await columnType(part));
}

export type SearchDirection = 'ASC' | 'DESC';
type Range = { start: Date; end: Date };

/** The leading sort key windows are cut on, and the length of its buckets. */
export type SearchCut = { expression: string; bucketMs: number };

// Rounded leading keys whose buckets divide 15 minutes. Every current UTC
// offset is a multiple of 15 minutes, so these buckets align to UTC in any
// time zone and windows can be floored to the bucket length.
const ROUNDED_KEY_BUCKET_MS: Record<string, number> = {
  toStartOfSecond: 1000,
  toStartOfMinute: 60_000,
  toStartOfFiveMinute: 300_000,
  toStartOfFiveMinutes: 300_000,
  toStartOfFifteenMinutes: 900_000,
};

async function resolveCut(
  leading: string,
  timestampValueExpression: string,
  columnType: (column: string) => Promise<string | undefined>,
): Promise<SearchCut | null> {
  if (await isExactTimestampPart(leading, columnType)) {
    return { expression: leading, bucketMs: 1000 };
  }
  const bucketMs =
    ROUNDED_KEY_BUCKET_MS[parseToStartOfFunction(leading)?.function ?? ''];
  if (bucketMs == null) return null;
  // Rounded bounds are inclusive on both ends; an exact part's strict bound
  // is what keeps windows half-open.
  for (const part of splitAndTrimWithBracket(timestampValueExpression)) {
    if (await isExactTimestampPart(part, columnType)) {
      return { expression: leading, bucketMs };
    }
  }
  return null;
}

export async function resolveFirstSearchWindow(
  source: { timestampValueExpression?: string },
  orderBy: string,
  startDate: Date,
  endDate: Date,
  {
    forceSingleWindow = false,
    columnType = async () => undefined,
  }: {
    forceSingleWindow?: boolean;
    columnType?: (column: string) => Promise<string | undefined>;
  } = {},
): Promise<{
  window: CursorWindow;
  windowed: boolean;
  cut: SearchCut | null;
  direction: SearchDirection;
}> {
  const direction = isFirstOrderByAscending(orderBy) ? 'ASC' : 'DESC';
  const wholeRange = {
    ordinal: 0,
    startTime: startDate.toISOString(),
    endTime: endDate.toISOString(),
  };
  const leading = leadingTimestampPart(
    orderBy,
    source.timestampValueExpression,
  );
  // Window boundaries are floored to the leading key's bucket, so one bucket's
  // rows, which the sort keeps together, never span two windows.
  const cut =
    !forceSingleWindow && startDate < endDate && leading != null
      ? await resolveCut(
          leading,
          source.timestampValueExpression ?? '',
          columnType,
        )
      : null;
  if (cut == null) {
    return { window: wholeRange, windowed: false, cut, direction };
  }

  // Step from an empty window at the edge the walk starts from.
  const edge = (direction === 'DESC' ? endDate : startDate).toISOString();
  const first = nextSearchWindow(
    { ordinal: -1, startTime: edge, endTime: edge },
    { start: startDate, end: endDate },
    direction,
    cut.bucketMs,
  );
  return { window: first ?? wholeRange, windowed: true, cut, direction };
}

const WINDOW_SIZES_MS = DEFAULT_TIME_WINDOWS_SECONDS.map(sec => sec * 1000);
const LARGEST_WINDOW_MS = WINDOW_SIZES_MS[WINDOW_SIZES_MS.length - 1];

// Total length of the first `count` windows; the largest size repeats.
function cumulativeWindowMs(count: number): number {
  const listed = WINDOW_SIZES_MS.slice(0, count).reduce((a, b) => a + b, 0);
  return (
    listed + Math.max(0, count - WINDOW_SIZES_MS.length) * LARGEST_WINDOW_MS
  );
}

// Boundaries between windows are floored to the bucket (a second for an exact
// key), so a second-precision column such as TimestampTime doesn't drop rows
// at a boundary. The caller's bounds stay exact; a window that flooring
// empties is skipped.
const floorToBucket = (ms: number, startMs: number, bucketMs: number) =>
  Math.max(Math.floor(ms / bucketMs) * bucketMs, startMs);

/**
 * The window after `current`, or null when the walk has reached the range
 * edge. Its near edge is the current window's far edge, so windows never gap
 * or overlap; its far edge is measured from the range edge, so flooring
 * doesn't accumulate.
 */
export function nextSearchWindow(
  current: CursorWindow,
  range: Range,
  direction: SearchDirection,
  bucketMs = 1000,
): CursorWindow | null {
  const startMs = range.start.getTime();
  const endMs = range.end.getTime();
  let { ordinal } = current;
  let ws = Date.parse(current.startTime);
  let we = Date.parse(current.endTime);
  for (;;) {
    ordinal += 1;
    if (direction === 'DESC') {
      if (ws <= startMs) return null;
      we = ws;
      const raw = endMs - cumulativeWindowMs(ordinal + 1);
      ws = raw <= startMs ? startMs : floorToBucket(raw, startMs, bucketMs);
    } else {
      if (we >= endMs) return null;
      ws = we;
      const raw = startMs + cumulativeWindowMs(ordinal + 1);
      we = raw >= endMs ? endMs : floorToBucket(raw, startMs, bucketMs);
    }
    if (ws < we) {
      return {
        ordinal,
        startTime: new Date(ws).toISOString(),
        endTime: new Date(we).toISOString(),
      };
    }
  }
}

/** Windows are [start, end); the one holding the range end also includes it. */
export function windowBounds(
  window: CursorWindow,
  range: Range,
): {
  dateRange: [Date, Date];
  dateRangeStartInclusive: true;
  dateRangeEndInclusive: boolean;
} {
  const end = new Date(window.endTime);
  return {
    dateRange: [new Date(window.startTime), end],
    dateRangeStartInclusive: true,
    dateRangeEndInclusive: end.getTime() === range.end.getTime(),
  };
}

/**
 * Shrinks a window to the rows not yet returned, cut at the last row's bucket,
 * so the next page's offset only skips that bucket's returned rows. The far
 * edge is untouched, so nextSearchWindow is unaffected.
 */
export function cutWindowAtBucket({
  window,
  direction,
  offset,
  pageLength,
  lastBucketMs,
  bucketMs,
  trailingRunLength,
}: {
  window: CursorWindow;
  direction: SearchDirection;
  offset: number;
  pageLength: number;
  lastBucketMs: number;
  bucketMs: number;
  trailingRunLength: number;
}): { window: CursorWindow; offset: number } {
  const startMs = Date.parse(window.startTime);
  const endMs = Date.parse(window.endTime);
  const cut =
    direction === 'DESC'
      ? {
          ...window,
          endTime: new Date(
            Math.min(lastBucketMs + bucketMs, endMs),
          ).toISOString(),
        }
      : {
          ...window,
          startTime: new Date(Math.max(lastBucketMs, startMs)).toISOString(),
        };
  // An unchanged window means the whole page was that one second.
  const unchanged =
    cut.startTime === window.startTime && cut.endTime === window.endTime;
  return {
    window: unchanged ? window : cut,
    offset: unchanged ? offset + pageLength : trailingRunLength,
  };
}
