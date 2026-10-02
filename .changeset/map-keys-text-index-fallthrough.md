---
'@hyperdx/common-utils': patch
'@hyperdx/app': patch
---

fix: fall back to the table scan when the Map key text index query fails, so key
autocomplete works on tables with row policies (where ClickHouse refuses
`mergeTreeTextIndex` with `ACCESS_DENIED`) instead of showing no keys.
