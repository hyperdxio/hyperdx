---
'@hyperdx/api': minor
---

Add a `clickstack_query_tiles` MCP tool that validates many dashboard tiles in
a single call. It accepts a dashboard ID and an optional list of tile IDs
(default: every non-markdown tile), runs the tile queries with bounded
concurrency, and returns a compact per-tile success/failure summary
(status, row count, errors, and raw-SQL macro warnings) plus an aggregate
count. A tile that fails to query is reported inline without failing the whole
call, so an agent can validate an entire dashboard in one or two calls instead
of one `clickstack_query_tile` call per tile. The `clickstack_save_dashboard`
guidance now points at the batch tool for post-save validation.
