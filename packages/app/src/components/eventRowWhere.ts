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
