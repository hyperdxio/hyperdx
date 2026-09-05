---
'@hyperdx/common-utils': patch
'@hyperdx/app': patch
'@hyperdx/api': patch
---

fix: don't scan the whole table to discover Map keys

`getMapKeys` carried a time predicate only if the caller happened to supply both
a date range and a timestamp expression, and fell open when it didn't: the
raw-table `sampledKeys` scan went out with no `WHERE` at all, and the text-index
read's `partsOverlapFilter` collapsed to `WHERE 1`. Several UI autocomplete call
sites supply neither input. The raw scan's inner `LIMIT` prunes rows, not parts,
so ClickHouse still selected every active part: on a large date-partitioned
table with cold parts on object storage that meant tens of thousands of parts,
minutes of scanning and a burst of S3 GETs per fetch.

Both paths now refuse to run without something to bound them. The rollup-table
path is unaffected — it carries its own time filter.

Key discovery always covers at least 24 hours, hour-aligned: callers with no
range of their own get that window, and a narrower one (a dashboard on "Last 15
minutes") is widened to it, so narrowing the time picker never returns fewer
keys than having no picker at all. Plain columns still autocomplete either way. The chart editor
(including its order-by and heatmap settings), alert and dashboard-filter
editors now pass the source and date range they already had in scope.
`MetadataCache.getOrFetch` now cancels its shared query only once every waiter
has given up, so one caller abandoning a fetch no longer rejects the others
queued behind the same cache key.

Known gap: the SQL editors in the source-configuration forms and the raw SQL
chart editor pass no timestamp expression, so on tables with neither a text
index nor a metadata MV — where only the raw scan can answer — Map keys still
don't autocomplete. The forms need the in-progress `timestampValueExpression`,
and the raw SQL editor offers tables from every source on the connection, so it
needs one expression per table rather than a single shared one.
