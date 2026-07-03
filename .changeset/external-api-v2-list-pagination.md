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
