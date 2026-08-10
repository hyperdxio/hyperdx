---
'@hyperdx/app': minor
---

Cap the number of rows a raw SQL dashboard tile query returns to protect the
browser from pathological high-cardinality queries. Raw SQL tiles rendered as a
line, stacked-bar, pie, or bar chart now run with two complementary ClickHouse
guards capped at 5,000 (+1 row of headroom): `max_result_rows` +
`result_overflow_mode = 'break'` (bounds the result rows) and
`max_rows_to_group_by` + `group_by_overflow_mode = 'any'` (bounds the aggregation
cardinality — the number of unique GROUP BY keys — which is what actually
protects server memory, since `break` alone is defeated by results that fit in a
single block). (Builder tiles already bound cardinality via the per-tile series
limit, and builder tables page rows separately, so they are unaffected.) When a
query hits the cap, an inline warning below the chart header notes the chart may
be missing data and nudges the user to narrow the query.

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
