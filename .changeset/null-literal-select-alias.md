---
'@hyperdx/common-utils': patch
---

Fix `NULL AS "alias"` projections being dropped from the SELECT alias map. A
column projected as a NULL literal was omitted, so anything resolving a value
back to its source expression (for example building a WHERE clause that
identifies a specific row) treated the alias as a real table column and
produced SQL referencing a column that does not exist.
