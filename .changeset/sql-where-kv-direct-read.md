---
'@hyperdx/common-utils': patch
---

Apply the Map KV text-index rewrite (`Map['k'] = 'v'` → `has(ItemsCol, concat('k', '=', 'v'))`, enabling ClickHouse's direct-read optimization) to SQL predicates in the top-level `where` (search box, saved searches, alerts) and to SQL `aggCondition`s copied into the WHERE clause — previously only `sql`-type `filters[]` entries were rewritten
