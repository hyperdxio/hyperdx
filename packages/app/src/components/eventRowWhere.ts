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

// `rowWhere` is the search result; `eventRowWhere` is the span open in the
// waterfall. A new result of the same trace must not keep the previous span.
// The exception is the result that *is* that span — clearing it would drop the
// selection the click just made.
export function eventRowWhereForOpenedRow<T extends { id: string }>(
  current: T | null,
  openedRowWhere: string | null,
): T | null {
  if (
    current != null &&
    openedRowWhere != null &&
    current.id === openedRowWhere
  ) {
    return current;
  }
  return null;
}
