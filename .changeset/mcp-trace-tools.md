---
'@hyperdx/api': patch
---

feat(mcp): add trace waterfall and breakdown tools

Add `hyperdx_trace_waterfall` — fetch all spans in a single trace as a
parent/child waterfall tree with optional correlated logs. Supports
auto-pick by slowest, first error, or most recent trace.

Add `hyperdx_trace_top_time_consuming_operations` — aggregate breakdown
of child operations consuming the most cumulative time across traces
matching a parent-span filter. Same algorithm as the in-app "Top Most
Time Consuming Operations" chart.
