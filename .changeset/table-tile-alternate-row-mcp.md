---
"@hyperdx/api": patch
---

feat(mcp): expose table tile alternate row background in the dashboard authoring tool

The clickstack_save_dashboard and clickstack_patch_dashboard MCP tools now accept alternateRowBackground on table tiles, both builder and raw SQL, so AI-authored dashboards can turn on zebra striping. Defaults to false.
