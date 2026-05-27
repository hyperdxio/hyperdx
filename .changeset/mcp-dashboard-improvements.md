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

**Breaking (minor):** Tile `name` on `hyperdx_save_dashboard` now requires
at least 1 character (`.min(1)`). Previously empty string `""` was accepted
and silently persisted as a blank title. Callers sending `name: ""` will
now receive a validation error.
