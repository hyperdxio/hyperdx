---
"@hyperdx/api": minor
---

External API v2: add offset/limit pagination to the alerts, saved-searches, and
webhooks list endpoints. Each now accepts `limit` (1–1000, default 1000) and
`offset` (>=0, default 0) query params and returns a `meta: { total, limit,
offset }` block alongside `data`. Results are sorted by `_id` so paging is
stable across requests.

Backward compatible: the default `limit` is the maximum (1000), so callers that
don't paginate keep receiving all their records (up to the cap) as before. Use
`limit`/`offset` to page through larger result sets.

Behavior change: `/api/v2/alerts` and `/api/v2/webhooks` were previously
unbounded and now hard-cap a single page at 1000 records. A team that exceeds
1000 alerts or webhooks will only see the first 1000 unless the client reads
the total and pages with `offset`; the full set is still reachable, but a
pre-`meta` client that never paginated would silently process only the first
page. To make the truncation detectable without parsing the body, each list
response now also sets an `X-Total-Count` header with the full count (matching
`meta.total`), and the server logs a warning when a default-limit page is
truncated.
