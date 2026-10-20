---
'@hyperdx/app': patch
---

Fix expanding a row on tables with a string `id` column: row details now keep the internal WHERE-clause id instead of being overwritten by the raw column value (#3370)
