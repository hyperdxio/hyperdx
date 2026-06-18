---
'@hyperdx/api': patch
---

fix(mcp): improve error hints and fix readonly mode for query safety settings

Switch MCP ClickHouse safety settings from readonly=1 to readonly=2 so
max_execution_time and max_result_rows are actually applied (readonly=1
silently rejects all setting changes).

Improve DateTime64 cast error hint to recommend parseDateTime64BestEffort()
which works on both DateTime and DateTime64 columns, replacing
toDateTime64() which only works on DateTime64.

Add error hint for unknown column/identifier errors directing agents to
call describe_source before retrying.
