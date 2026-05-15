---
'@hyperdx/api': patch
---

refactor(mcp): split hyperdx_query into 5 display-type-specific tools

Replace the monolithic `hyperdx_query` tool with five narrow tools:
- `hyperdx_timeseries` (line + stacked_bar)
- `hyperdx_table` (table + number + pie, with shape auto-upgrade)
- `hyperdx_search` (raw event browsing)
- `hyperdx_event_patterns` (Drain pattern mining)
- `hyperdx_sql` (raw ClickHouse SQL)

Each tool's schema contains only its relevant parameters — no displayType
discriminator, no fields from other modes, no conditional required fields.
`hyperdx_query` is removed from the tool surface.
