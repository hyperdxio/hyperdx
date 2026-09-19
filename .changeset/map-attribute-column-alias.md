---
'@hyperdx/common-utils': patch
'@hyperdx/app': patch
'@hyperdx/api': patch
---

fix: label Map attribute columns in search results by their key

Selecting `LogAttributes['service.name']` as a column labelled the results-table header, and everything else that reads the result column name such as exports, with ClickHouse's derived name `arrayElement(LogAttributes, 'service.name')`. Bare Map subscripts in the select are now aliased after their key, so the column reads `service.name`. A key that would shadow a table column or another selected name keeps the derived name, and the same key selected from two maps is prefixed with the map (`LogAttributes.http.method`).
