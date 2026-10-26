---
'@hyperdx/common-utils': patch
'@hyperdx/api': patch
'@hyperdx/app': patch
---

fix: support Lucene range searches on JSON column paths

A range such as `ResourceAttributesJSON.http.status:[400 TO 499]` rendered
`(( BETWEEN 400 AND 499))`, a ClickHouse syntax error. Ranges on a JSON path now
compare the path's numeric value, as `>`, `>=`, `<` and `<=` already do.
