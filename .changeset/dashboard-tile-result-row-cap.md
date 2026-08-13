---
'@hyperdx/app': minor
---

Cap the number of rows a raw SQL dashboard tile query returns to protect the
browser from pathological high-cardinality queries. Raw SQL tiles rendered as a
line, stacked-bar, pie, or bar chart now run capped at 5,000 (+1 row of
headroom) via an order-preserving result-row cap (`max_result_rows` +
`result_overflow_mode = 'break'`, which trims the tail after the query's own
ORDER BY/LIMIT). Because that cap is block-aligned and weak on its own (a result
fitting in one block is returned whole), queries with no outer `LIMIT` also get
a group-by cardinality cap (`max_rows_to_group_by` + `group_by_overflow_mode =
'break'`) that bounds unique GROUP BY keys — the setting that actually protects
server memory. The cardinality cap is deliberately **skipped** for raw SQL that
carries its own outer `LIMIT`: it stops accumulating keys during aggregation,
before an outer `ORDER BY … LIMIT N` runs, so applying it there would compute the
top-N over an arbitrary key subset and render silently wrong values. (Builder
tiles already bound cardinality via the per-tile series limit, and builder tables
page rows separately, so they are unaffected.) When a query hits the cap, an
inline warning below the chart header notes the chart may be missing data and
nudges the user to narrow the query.

To avoid a false warning when a complete result happens to be exactly the cap
size, the query runs with one row of headroom (`cap + 1`): a result of ≤ cap
rows comes back whole and is not flagged, while a larger result trips the cap and
is detected via the returned row count. Only the returned row count is used for
detection (never `rows_before_limit_at_least`), so a tile whose own SQL ends in a
`LIMIT` is not falsely flagged just because the pre-`LIMIT` aggregation was
large. Both caps are block-aligned (soft), so the returned result can overshoot
the cap by up to one block; because detection can't prove the server actually
dropped rows, the banner says the chart "may be missing data" rather than
asserting truncation. The warning also clears while a narrowed query is
in flight (it no longer lingers on stale placeholder data), and when a chart's
result is both row-capped and series-capped the "hidden series" notice no longer
claims all series were loaded.
