---
'@hyperdx/api': patch
---

fix(mcp): guide agents to size dashboard tiles correctly (HDX-4661)

Teach the MCP dashboard tools to pick deliberate tile sizes instead of
leaving everything at the 12x4 default.

- Add per-displayType width/height guidance to the tile layout `w` and `h`
  descriptions in the save/patch schemas (number tiles stay small, tables
  and search lists take the full row, etc.).
- Replace the cramped `h: 1` markdown advice with sizing that fits the text
  and add design-checklist rule 14 "SIZE TILES TO FIT THEIR CONTENT" to the
  create-dashboard prompt.
