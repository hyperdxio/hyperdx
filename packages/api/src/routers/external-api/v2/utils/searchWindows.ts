import {
  generateTimeWindowsAscending,
  generateTimeWindowsDescending,
  TimeWindow,
} from '@hyperdx/common-utils/dist/core/searchWindows';
import {
  getFirstOrderingItem,
  isFirstOrderByAscending,
  removeTrailingDirection,
  splitAndTrimWithBracket,
} from '@hyperdx/common-utils/dist/core/utils';
import type { TSource } from '@hyperdx/common-utils/dist/types';

// Windows are emitted oldest-first or newest-first, so they only preserve the
// requested order when the first sort key is the timestamp itself; a derived
// key such as toHour(Timestamp) restarts every day.
function ordersByTimestamp(
  orderBy: string,
  timestampValueExpression: string | undefined,
): boolean {
  const first = getFirstOrderingItem(orderBy);
  if (typeof first !== 'string' || timestampValueExpression == null) {
    return false;
  }
  const expression = removeTrailingDirection(first);
  // The default order is a tuple such as (TimestampTime, Timestamp); its
  // leading element decides whether rows come out in timestamp order.
  const leading = /^\(.*\)$/s.test(expression)
    ? splitAndTrimWithBracket(expression.slice(1, -1))[0]
    : expression;
  return splitAndTrimWithBracket(timestampValueExpression).includes(leading);
}

export function resolveSearchWindows(
  source: TSource,
  orderBy: string,
  startDate: Date,
  endDate: Date,
  { forceSingleWindow = false }: { forceSingleWindow?: boolean } = {},
): TimeWindow[] {
  // renderChartConfig forces both bounds inclusive for toStartOf*/Date-typed
  // timestamp expressions, which defeats the half-open windows below and would
  // return boundary rows on two consecutive pages. Fall back to one window.
  const roundsTimestamp = /\btoStartOf|\btoDate\s*\(/i.test(
    source.timestampValueExpression ?? '',
  );

  const canWindow =
    !forceSingleWindow &&
    !roundsTimestamp &&
    ordersByTimestamp(orderBy, source.timestampValueExpression);

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

  return isFirstOrderByAscending(orderBy)
    ? generateTimeWindowsAscending(startDate, endDate)
    : generateTimeWindowsDescending(startDate, endDate);
}
