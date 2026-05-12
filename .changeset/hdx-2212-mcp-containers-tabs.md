---
'@hyperdx/api': minor
---

MCP `hyperdx_save_dashboard` now accepts the dashboard organization layer
added in #2201: an optional `containers` array on the dashboard, plus
`containerId` and `tabId` on each tile. The same five cross-field rules
the external API enforces fire on the MCP path: container ids unique,
tab ids unique within a container, tile.containerId resolves, tile.tabId
resolves to a tab on that container, and tile.tabId requires
tile.containerId. The MCP `buildQueryGuidePrompt` documents the new
shape under a CONTAINERS AND TABS section.
