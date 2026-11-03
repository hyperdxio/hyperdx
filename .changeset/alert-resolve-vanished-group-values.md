---
'@hyperdx/api': patch
---

fix: A grouped alert whose group vanishes from the data now resolves with the group's values in `{{attributes.*}}` (alert title and message) and `{{var.*}}` (webhook body)
