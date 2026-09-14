---
'@hyperdx/common-utils': patch
'@hyperdx/app': patch
---

fix: disable per-part subcolumn size calculation on ClickHouse 26.3+

ClickHouse 26.3 turned on
`allow_calculating_subcolumns_sizes_for_merge_tree_reading` by default, which
makes PREWHERE planning fetch per-part sizes for every map key a query
references. On SharedMergeTree that is one S3 GET per (key × active part), it
runs before any row is read, and `max_execution_time` does not interrupt it.
Queries referencing many attribute keys — the LLM dashboard reads ~64 — could
spend minutes in planning. Queries now send the setting as `0` when the server
supports it.
