---
'@hyperdx/api': patch
---

fix(mcp): stop `clickstack_sql` callers from guessing table and timestamp column
names. `clickstack_list_sources` now returns each source's database-qualified
`table` (and `database` for metric sources), the `sql` examples use `<table>`
and `<timestampColumn>` placeholders instead of `otel_logs` and `TimestampTime`,
and unknown-table errors from `clickstack_sql` point at `clickstack_list_sources`.
