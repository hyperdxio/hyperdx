---
'@hyperdx/api': minor
---

feat(api/mcp): add heatmap tile schema for hyperdx_save_dashboard

Adds a `heatmap` display type to the MCP `mcpTilesParam` schema so AI agents
can author heatmap tiles via `hyperdx_save_dashboard`. The new
`mcpHeatmapSelectItemSchema` carries `valueExpression`, `countExpression`,
`alias`, and `heatmapScaleType`, mirroring the heatmap fields persisted in
`DerivedColumnSchema`. Chart-config-level `where` and `whereLanguage` match
the external API surface (PR #2200) so MCP clients can filter heatmap data.
