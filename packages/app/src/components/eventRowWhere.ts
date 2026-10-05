import { z } from 'zod';
import { WithClauseSchema } from '@hyperdx/common-utils/dist/types';

import { parseAsJsonEncoded } from '@/utils/queryParsers';

// Validate the persisted span selection so a stale / hand-edited `eventRowWhere`
// (valid JSON but wrong shape) resolves to null instead of feeding a malformed
// row id into the span detail query.
const eventRowWhereSchema = z.object({
  id: z.string(),
  type: z.string(),
  aliasWith: z.array(WithClauseSchema),
  // The trace this span selection was made in. Used to gate a selection left in
  // the URL from a previous trace so it can't render against a different one.
  traceId: z.string().optional(),
});

export type EventRowWhere = z.infer<typeof eventRowWhereSchema>;

export const eventRowWhereParser = parseAsJsonEncoded<EventRowWhere>(
  eventRowWhereSchema.parse,
);

// `openRowWhere` is the search result already open. `openedRowWhere` is the
// result being opened. Both come from the search table. The waterfall's
// `eventRowWhere.id` is built from different columns, so comparing it to
// either string never matches and would always clear the span.
// Opening a different result of the same trace must drop the previous span.
// Re-opening the result already open must keep the span picked in the waterfall.
export function eventRowWhereForOpenedRow<T>(
  current: T | null,
  openRowWhere: string | null,
  openedRowWhere: string | null,
): T | null {
  if (
    current != null &&
    openRowWhere != null &&
    openRowWhere === openedRowWhere
  ) {
    return current;
  }
  return null;
}
