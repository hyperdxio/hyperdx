---
"@hyperdx/common-utils": patch
---

fix(charts): histogram bucket picks the highest-precision DateTime column when
Timestamp Column lists multiple columns

When a source's `Timestamp Column` listed multiple columns (e.g.
`"EventDate, EventTime"` for partition-pruning), the histogram bucket was
built from only the first token. If that token was a `Date` column, every
row in a day collapsed into a single bar at midnight UTC of that day.

The bucket resolver now walks the comma-split list, queries each column's
type via metadata, and returns the highest-precision DateTime / DateTime64
token. Date columns are skipped. If no DateTime-typed token is found, the
original first-token behavior is preserved with a `console.warn`.

The WHERE clause continues to use the multi-column form, so partition
pruning via the `Date` column keeps working. The same resolved column is
also used for the `argMin` / `argMax` / `min` / `max` time math in delta
expressions.

Fixes HDX-4371.
