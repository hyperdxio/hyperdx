---
'@hyperdx/app': patch
'@hyperdx/common-utils': patch
---

feat: on ClickHouse Cloud, read `system.shared_merge_tree_settings` when detecting `_block_number` and `_block_offset` columns, falling back to `system.merge_tree_settings` per key
