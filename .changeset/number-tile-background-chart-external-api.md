---
"@hyperdx/api": patch
---

Add `backgroundChart` support to number tiles in the external dashboards API (`/api/v2/dashboards`). Builder number tiles can now carry an optional background trend sparkline (`type` line or area, with an optional palette-token `color`) over the v2 REST API, matching the dashboard editor. Raw SQL number tiles do not support it.
