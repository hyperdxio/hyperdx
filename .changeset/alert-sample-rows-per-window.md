---
'@hyperdx/api': patch
---

fix: fetch a saved-search alert's sample rows once per window

A saved-search alert quotes five sample rows in its notification body, fetched
with a query that carries the saved search's filter and the evaluation window
but no group predicate. That query ran inside the per-group render, so a grouped
alert re-ran it once per group for a byte-identical result — ten groups meant
ten scans of the same window. It now runs once per window and every
notification for that window shares the result, and the alias clauses the
evaluation already resolved are reused instead of being recomputed for each
group.
