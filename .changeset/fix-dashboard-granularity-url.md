---
"@hyperdx/app": patch
---

Fix `href interpolation failed` error when loading a dashboard page directly without query params by guarding the granularity URL sync until the router is ready.
