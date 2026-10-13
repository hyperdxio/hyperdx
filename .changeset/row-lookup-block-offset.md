---
'@hyperdx/app': patch
---

fix: resolve row details with primary key + `_block_offset` when a table only
persists `enable_block_offset_column`, instead of falling back to the slow
full-row lookup that required `enable_block_number_column` too
