---
'@hyperdx/api': patch
---

MCP: reject execution of persisted dashboard tiles whose metric config uses an aggregation function its metric kind does not support (e.g. avg/sum/min/max on a histogram or exponential histogram). `clickstack_query_tile` now validates the tile's metric select items with the same rules the query and save/patch tools apply, returning an actionable error instead of an opaque ClickHouse render failure for tiles created outside MCP validation (REST/UI/legacy).
