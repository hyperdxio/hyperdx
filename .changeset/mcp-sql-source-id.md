---
'@hyperdx/api': patch
---

feat(mcp): `clickstack_sql` accepts an optional `sourceId`, so `$__sourceTable`
expands to that source's table. Unknown sources, other teams' sources, and a
source on a different connection than `connectionId` are rejected, as is
`$__sourceTable` without a `sourceId`.
