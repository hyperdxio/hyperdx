---
'@hyperdx/app': patch
'@hyperdx/common-utils': patch
---

Fix Search sidebar filters on native JSON columns by serializing their values as ClickHouse string expressions while preserving Map-column bracket access.
