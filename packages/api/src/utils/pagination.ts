import { z } from 'zod';

import { getCounter } from '@/utils/instrumentation';
import logger from '@/utils/logger';

// Countable log event (see agent_docs/observability.md): every truncated page
// also increments a metric so operators can alert on / graph truncation without
// scraping logs. `resource` is low-cardinality (a fixed set of list endpoints).
const paginationTruncationCounter = getCounter(
  'hyperdx.api.pagination.truncated',
  {
    description:
      'Count of external API list responses truncated at the default max page limit, labeled by resource.',
  },
);

// ponytail: offset pagination is fine for team-scoped metadata collections
// (saved searches, webhooks, alerts) — these top out in the thousands. Switch
// to cursor-based only if a single team's collection ever grows past ~100k rows.
const MAX_PAGINATION_LIMIT = 1000;

// Default limit is the max: these list endpoints were previously unbounded, so
// defaulting to the cap keeps existing non-paginating clients working while
// still bounding the response. When a team outgrows the cap, paginationMeta
// logs the truncation (see below) so it isn't silent.
export const paginationQuerySchema = z.object({
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(MAX_PAGINATION_LIMIT)
    .default(MAX_PAGINATION_LIMIT),
  offset: z.coerce.number().int().min(0).default(0),
});

export type Pagination = z.infer<typeof paginationQuerySchema>;

// processRequestWithEnhancedErrors assigns the parsed query back onto
// req.query, but re-parsing here keeps the numeric types without a cast and is
// cheap.
export function getPagination(query: unknown): Pagination {
  return paginationQuerySchema.parse(query ?? {});
}

export function paginationMeta(
  { limit, offset }: Pagination,
  total: number,
  resource?: string,
) {
  // Surface silent truncation. When the page is capped at the default max
  // limit and more rows exist than were returned, a client that does not read
  // meta.total and paginate silently only ever sees the first page. Log it so
  // operators can spot teams that have outgrown the default cap rather than
  // treating the truncation as invisible/backward-compatible. Clients that
  // supply a smaller limit are paginating deliberately and are not warned.
  if (limit === MAX_PAGINATION_LIMIT && total > limit + offset) {
    logger.warn(
      { resource, total, limit, offset },
      'Paginated list truncated at the default max limit: more records exist than were returned. Client must read meta.total and paginate.',
    );
    paginationTruncationCounter.add(1, { resource: resource ?? 'unknown' });
  }
  return { total, limit, offset };
}

/**
 * Opaque cursor for keyset pagination: base64url JSON, so a cursor survives a
 * query string unescaped. Opaque by convention only — it is neither signed nor
 * encrypted, so keep client-visible data in the payload and always validate the
 * decoded shape with `decodeCursor`.
 */
export function encodeCursor(payload: unknown): string {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

/**
 * `null` for anything that isn't a cursor the caller's schema recognizes —
 * truncated, tampered with, or left over from an earlier payload shape. Callers
 * turn that into a 400 (or start the walk over) rather than leaking a decode
 * error. Decoding accepts standard base64 as well as base64url, so cursors
 * issued before this encoding switched remain readable.
 */
export function decodeCursor<T>(raw: string, schema: z.ZodType<T>): T | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  const result = schema.safeParse(parsed);
  return result.success ? result.data : null;
}
