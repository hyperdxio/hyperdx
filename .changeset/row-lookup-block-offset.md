---
'@hyperdx/app': patch
---

fix: resolve row details with the primary key plus whichever of `_block_number`
/ `_block_offset` the table persists, instead of falling back to the slow
full-row lookup when only one of `enable_block_number_column` /
`enable_block_offset_column` is set
