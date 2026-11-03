---
'@hyperdx/api': patch
---

fix: ignore `team` and `createdBy` in dashboard and saved search PATCH bodies so they can't be moved to another team or have their owner rewritten
