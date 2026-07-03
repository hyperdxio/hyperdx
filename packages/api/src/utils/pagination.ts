import { z } from 'zod';

// ponytail: offset pagination is fine for team-scoped metadata collections
// (saved searches, webhooks, alerts) — these top out in the thousands. Switch
// to cursor-based only if a single team's collection ever grows past ~100k rows.
// Default limit is the max (1000): these list endpoints were previously
// unbounded, so defaulting to the cap keeps existing clients that don't paginate
// backward-compatible while still bounding the response.
export const paginationQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(1000).default(1000),
  offset: z.coerce.number().int().min(0).default(0),
});

export type Pagination = z.infer<typeof paginationQuerySchema>;

// processRequestWithEnhancedErrors assigns the parsed query back onto
// req.query, but re-parsing here keeps the numeric types without a cast and is
// cheap.
export function getPagination(query: unknown): Pagination {
  return paginationQuerySchema.parse(query ?? {});
}

export function paginationMeta({ limit, offset }: Pagination, total: number) {
  return { total, limit, offset };
}
