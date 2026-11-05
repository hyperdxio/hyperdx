---
'@hyperdx/app': patch
---

fix: only use the key-only row details lookup when the table persists both `_block_number` and `_block_offset`. A lone block column (e.g. a server-wide `enable_block_offset_column`) is not unique with a second-precision primary key and could open the wrong row; it is now only added as a tiebreaker to the full-row lookup.
