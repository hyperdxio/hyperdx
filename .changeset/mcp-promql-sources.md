---
'@hyperdx/api': minor
---

feat: Describe PromQL sources in MCP and hide them when PromQL is disabled

`clickstack_describe_source` now returns the label names and metric names of a PromQL source, from either a ClickHouse TimeSeries table or a Prometheus-compatible endpoint, instead of a column schema. `clickstack_list_sources` and `clickstack_describe_source` show which backend a PromQL source uses, and for TimeSeries tables explain how to read them with `clickstack_sql`. Prometheus endpoint sources no longer show their placeholder table. When `ENABLE_PROMQL` is off, MCP hides PromQL sources from listing, describing and deleting, and `clickstack_save_source` no longer accepts `kind: "promql"`.
