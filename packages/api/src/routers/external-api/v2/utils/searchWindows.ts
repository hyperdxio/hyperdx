import {
  generateTimeWindowsAscending,
  generateTimeWindowsDescending,
  TimeWindow,
} from '@hyperdx/common-utils/dist/core/searchWindows';
import {
  classifyTimestampType,
  getFirstOrderingItem,
  isFirstOrderByAscending,
  parseToStartOfFunction,
  removeTrailingDirection,
  splitAndTrimWithBracket,
} from '@hyperdx/common-utils/dist/core/utils';

// Windows keep the requested order only when the first sort key is the
// timestamp itself, not a derived key such as toHour(Timestamp). Stricter than
// isTimestampExpressionInFirstOrderBy, which accepts any key containing it.
function ordersByTimestamp(
  orderBy: string,
  timestampValueExpression: string | undefined,
): boolean {
  const first = getFirstOrderingItem(orderBy);
  if (typeof first !== 'string' || timestampValueExpression == null) {
    return false;
  }
  const expression = removeTrailingDirection(first);
  // A tuple order such as (TimestampTime, Timestamp) is led by its first element.
  const leading = /^\(.*\)$/s.test(expression)
    ? splitAndTrimWithBracket(expression.slice(1, -1))[0]
    : expression;
  return splitAndTrimWithBracket(timestampValueExpression).includes(leading);
}

// toStartOf*, toDate and Date-typed parts get inclusive bounds on both ends.
// Windows stay half-open only if another part compares exact times.
async function keepsExactTime(
  timestampValueExpression: string,
  columnType: (column: string) => Promise<string | undefined>,
): Promise<boolean> {
  for (const part of splitAndTrimWithBracket(timestampValueExpression)) {
    if (parseToStartOfFunction(part) || /^toDate\s*\(/i.test(part)) continue;
    if (classifyTimestampType(await columnType(part))?.kind === 'date')
      continue;
    return true;
  }
  return false;
}

export async function resolveSearchWindows(
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
): Promise<TimeWindow[]> {
  const canWindow =
    !forceSingleWindow &&
    ordersByTimestamp(orderBy, source.timestampValueExpression) &&
    (await keepsExactTime(source.timestampValueExpression ?? '', columnType));

  if (!canWindow) {
    return [
      {
        startTime: startDate,
        endTime: endDate,
        windowIndex: 0,
        direction: isFirstOrderByAscending(orderBy) ? 'ASC' : 'DESC',
      },
    ];
  }

  const windows = isFirstOrderByAscending(orderBy)
    ? generateTimeWindowsAscending(startDate, endDate)
    : generateTimeWindowsDescending(startDate, endDate);
  return snapBoundariesToSeconds(windows, startDate, endDate);
}

// Floors boundaries between windows to the second, so a second-precision
// column such as TimestampTime doesn't drop rows at a boundary. The caller's
// bounds stay exact; windows left empty are dropped.
function snapBoundariesToSeconds(
  windows: TimeWindow[],
  startDate: Date,
  endDate: Date,
): TimeWindow[] {
  if (windows.length <= 1) return windows;

  const snap = (t: Date) => {
    if (
      t.getTime() === startDate.getTime() ||
      t.getTime() === endDate.getTime()
    ) {
      return t;
    }
    return new Date(
      Math.max(Math.floor(t.getTime() / 1000) * 1000, startDate.getTime()),
    );
  };

  return windows
    .map(w => ({
      ...w,
      startTime: snap(w.startTime),
      endTime: snap(w.endTime),
    }))
    .filter(w => w.startTime.getTime() < w.endTime.getTime())
    .map((w, windowIndex) => ({ ...w, windowIndex }));
}
