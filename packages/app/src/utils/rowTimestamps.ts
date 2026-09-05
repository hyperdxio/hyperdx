import { add } from 'date-fns';
import { ColumnMetaType } from '@hyperdx/common-utils/dist/clickhouse';
import {
  classifyTimestampType,
  splitAndTrimWithBracket,
} from '@hyperdx/common-utils/dist/core/utils';

/**
 * Alias for the i-th column of a source's (possibly composite)
 * `timestampValueExpression`, as projected by `useRowData`.
 */
export function timestampValueAlias(index: number): string {
  return `__hdx_timestamp_value_${index}`;
}

/**
 * Select entries projecting every column of a `timestampValueExpression`.
 *
 * All tokens are projected rather than just the first because which one carries
 * the event's real precision isn't knowable from the expression alone — the
 * conventional `"EventDate, EventTime"` sort key leads with a day-precision
 * `Date` used for partition pruning. The row response's `meta` types settle it;
 * see `resolveRowTimestampAnchor`.
 */
export function getTimestampValueSelects(
  timestampValueExpression: string | undefined,
): { valueExpression: string; alias: string }[] {
  if (!timestampValueExpression?.trim()) {
    return [];
  }
  return splitAndTrimWithBracket(timestampValueExpression).map(
    (valueExpression, index) => ({
      valueExpression,
      alias: timestampValueAlias(index),
    }),
  );
}

/**
 * The instant a row happened, resolved from the highest-precision timestamp
 * column the row query actually returned.
 *
 * Returns undefined when no DateTime-typed token came back — every token is
 * `Date`-typed, the values are missing, or `meta` is unavailable. Callers must
 * treat that as "no usable anchor" rather than falling back to a day-precision
 * value: that would place the instant at midnight, and anything deriving a
 * narrow window from it would exclude every event outside that midnight window.
 */
export function resolveRowTimestampAnchor({
  timestampValueExpression,
  row,
  meta,
}: {
  timestampValueExpression: string | undefined;
  row: Record<string, any> | undefined | null;
  meta: ColumnMetaType[] | undefined;
}): Date | undefined {
  if (!timestampValueExpression?.trim() || row == null || meta == null) {
    return undefined;
  }

  let best: { precision: number; date: Date } | undefined;

  splitAndTrimWithBracket(timestampValueExpression).forEach((_, index) => {
    const alias = timestampValueAlias(index);
    const classified = classifyTimestampType(
      meta.find(m => m.name === alias)?.type,
    );
    // Day-precision columns can't locate the event within its day.
    if (classified == null || classified.kind === 'date') {
      return;
    }

    const rawValue = row[alias];
    if (rawValue == null) {
      return;
    }
    const date =
      typeof rawValue === 'number'
        ? new Date(rawValue * 1000)
        : new Date(rawValue);
    if (isNaN(date.getTime())) {
      return;
    }

    // Highest precision wins; on a tie the earlier token does, matching
    // `pickBucketTimestampColumn`.
    if (best == null || classified.precision > best.precision) {
      best = { precision: classified.precision, date };
    }
  });

  return best?.date;
}

/**
 * How far a cross-source row lookup's window reaches on either side of the
 * origin row's instant.
 *
 * Asymmetric because the window is derived from the *origin* row's instant but
 * filtered against the *destination* source's `timestampValueExpression`. The
 * only push that carries an anchor today is "View Trace" (log → the span the log
 * belongs to), and a span always starts at or before the logs that reference it
 * while the traces schema's `Timestamp` is the span's *start* — so a symmetric
 * window silently drops any span that ran longer than the window and logged late
 * in its life. The lookback is therefore longer, and the lead only has to
 * cover clock skew between the log and span emitters.
 */
export const ROW_LOOKUP_WINDOW_LOOKBACK_HOURS = 4;
export const ROW_LOOKUP_WINDOW_LEAD_HOURS = 1;

/**
 * Window to bound a cross-source row lookup by, given the origin row's instant.
 * Returns undefined when focusTimestamp is not a valid date.
 */
export function getRowLookupWindow(
  focusTimestamp: string | null | undefined,
): [Date, Date] | undefined {
  if (!focusTimestamp?.trim()) {
    return undefined;
  }
  const focus = new Date(focusTimestamp);
  if (isNaN(focus.getTime())) {
    return undefined;
  }
  return [
    add(focus, { hours: -ROW_LOOKUP_WINDOW_LOOKBACK_HOURS }),
    add(focus, { hours: ROW_LOOKUP_WINDOW_LEAD_HOURS }),
  ];
}
