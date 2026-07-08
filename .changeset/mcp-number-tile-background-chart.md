---
"@hyperdx/api": patch
---

Add `backgroundChart` support to number tiles in the MCP dashboard tools (`clickstack_save_dashboard` and `clickstack_patch_dashboard`). Builder number tiles can now carry an optional background trend sparkline (`type` line or area, with an optional palette-token `color`), matching the dashboard editor and the v2 REST API. Raw SQL number tiles do not support it.
