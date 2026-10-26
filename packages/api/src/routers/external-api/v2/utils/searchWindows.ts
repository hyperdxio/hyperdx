import { DEFAULT_TIME_WINDOWS_SECONDS } from '@hyperdx/common-utils/dist/core/searchWindows';
import {
  getFirstOrderingItem,
  isFirstOrderByAscending,
  isRoundedTimestampPart,
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
  /** The exact timestamp part leading the sort; windows are cut on it. */
  cutPart: string | null;
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
  // Windows need an exact leading key: a boundary inside one rounded key
  // (a minute, a day) would split rows the sort keeps together.
  const cutPart =
    !forceSingleWindow &&
    startDate < endDate &&
    leading != null &&
    (await isExactTimestampPart(leading, columnType))
      ? leading
      : null;
  if (cutPart == null) {
    return { window: wholeRange, windowed: false, cutPart, direction };
  }

  // Step from an empty window at the edge the walk starts from.
  const edge = (direction === 'DESC' ? endDate : startDate).toISOString();
  const first = nextSearchWindow(
    { ordinal: -1, startTime: edge, endTime: edge },
    { start: startDate, end: endDate },
    direction,
  );
  return { window: first ?? wholeRange, windowed: true, cutPart, direction };
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

// Boundaries between windows are floored to the second, so a second-precision
// column such as TimestampTime doesn't drop rows at a boundary. The caller's
// bounds stay exact; a window that flooring empties is skipped.
const floorToSecond = (ms: number, startMs: number) =>
  Math.max(Math.floor(ms / 1000) * 1000, startMs);

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
      ws = raw <= startMs ? startMs : floorToSecond(raw, startMs);
    } else {
      if (we >= endMs) return null;
      ws = we;
      const raw = startMs + cumulativeWindowMs(ordinal + 1);
      we = raw >= endMs ? endMs : floorToSecond(raw, startMs);
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
 * Shrinks a window to the rows not yet returned, cut at the last row's whole
 * second, so the next page's offset only skips that second's returned rows.
 * The far edge is untouched, so nextSearchWindow is unaffected.
 */
export function cutWindowAtSecond({
  window,
  direction,
  offset,
  pageLength,
  lastSecondMs,
  trailingRunLength,
}: {
  window: CursorWindow;
  direction: SearchDirection;
  offset: number;
  pageLength: number;
  lastSecondMs: number;
  trailingRunLength: number;
}): { window: CursorWindow; offset: number } {
  const startMs = Date.parse(window.startTime);
  const endMs = Date.parse(window.endTime);
  const cut =
    direction === 'DESC'
      ? {
          ...window,
          endTime: new Date(Math.min(lastSecondMs + 1000, endMs)).toISOString(),
        }
      : {
          ...window,
          startTime: new Date(Math.max(lastSecondMs, startMs)).toISOString(),
        };
  // An unchanged window means the whole page was that one second.
  const unchanged =
    cut.startTime === window.startTime && cut.endTime === window.endTime;
  return {
    window: unchanged ? window : cut,
    offset: unchanged ? offset + pageLength : trailingRunLength,
  };
}
