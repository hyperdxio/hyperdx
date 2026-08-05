---
'@hyperdx/api': minor
---

feat: accept exemplar settings on API- and agent-authored dashboard tiles

`enableExemplars` and `exemplarTraceSourceId` are now accepted on line and
stacked-bar tiles through the external v2 API and the MCP dashboard tools, survive
the tile conversion in both directions, and are documented in the OpenAPI spec.
Previously they validated on write and were dropped before persistence, so the
overlay could only ever be switched on by a human in the chart editor.
