---
'@hyperdx/common-utils': minor
'@hyperdx/app': patch
'@hyperdx/api': patch
---

refactor: replace `TableConnection` with sources for field discovery

`TableConnection`, `TableConnectionChoice`, `tcFromSource` and
`tcFromChartConfig` are removed from `@hyperdx/common-utils`.
`Metadata.getAllFields` and `genEnglishExplanation` now take a source (plus a
metric type and metric name for metric sources) and read the table, timestamp
expression and metadata materialized views from it. Search inputs, SQL editors
and facet hooks take `source` / `sourceTables` props in place of
`tableConnection` / `tableConnections` and `sourceId`.

The raw SQL editor now autocompletes columns from metric sources' tables, which
it previously skipped.
