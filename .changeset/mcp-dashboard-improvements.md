---
'@hyperdx/api': patch
---

feat(mcp): add patch_dashboard, get_dashboard_tile, search_dashboards tools

Add three new MCP dashboard tools for granular operations:

- `hyperdx_get_dashboard_tile` — retrieve a single tile by tileId
- `hyperdx_patch_dashboard` — update name/tags and/or replace one tile
  without resubmitting the full dashboard
- `hyperdx_search_dashboards` — search by name and/or tags

Fix empty parameter schema on patch/search tools caused by Zod
`.refine()` wrapping. Document Lucene substring matching limitations
prominently in tool descriptions and query guide prompt.
