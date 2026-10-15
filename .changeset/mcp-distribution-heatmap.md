---
'@hyperdx/api': patch
'@hyperdx/common-utils': patch
---

feat: add a `clickstack_heatmap` MCP tool that returns how a value such as span
latency is distributed over time, as counts per time bucket and value range.
`clickstack_query_tile` now returns the same grid for distribution heatmap
tiles instead of failing. The distribution heatmap queries the web app runs
moved to common-utils so the API and CLI share them.
