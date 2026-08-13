---
'@hyperdx/api': patch
---

Guide dashboard MCP agents to filter builder tiles (table, line, stacked_bar,
number, pie, bar) with the per-series `where` on each select item, which the
chart editor surfaces as the tile's visible "Where" box. The dashboard prompt
and the select-item `where` tool description now steer toward it, and the save
and patch tools reject a tile-config-level `where`/`whereLanguage` on these
types with an actionable message (the editor does not render a tile-level filter
for them, so it would be invisible and uneditable). Search, heatmap, and
event_patterns tiles keep their tile-level `where`.
