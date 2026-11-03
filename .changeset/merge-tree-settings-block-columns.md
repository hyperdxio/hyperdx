---
'@hyperdx/app': patch
'@hyperdx/common-utils': patch
---

feat: fall back to server MergeTree settings to detect persisted `_block_number` and `_block_offset` columns when the table's CREATE query omits them
