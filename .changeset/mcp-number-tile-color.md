---
"@hyperdx/api": patch
---

Support number-tile color in the MCP dashboard tools. `save_dashboard` and `patch_dashboard` now accept a static `color` and conditional `colorRules` on builder number tiles, and a static `color` on raw SQL number tiles, matching the external REST dashboards API.
