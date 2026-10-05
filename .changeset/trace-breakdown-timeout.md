---
'@hyperdx/api': patch
---

fix(mcp): time-limit the `clickstack_trace_top_time_consuming_operations` tool.
Its queries now use the MCP request timeout and `max_execution_time` ceiling,
which a source's `querySettings` can no longer override. A timeout returns
guidance to shorten the window or narrow `parentFilter` instead of an "invalid
SQL" hint, and the client-side `Timeout error.` now gets the timeout hint in
every MCP tool. Sources with a multi-column `timestampValueExpression`
(including a leading Date column such as `EventDate, EventTime`) now return
correct breakdowns.
