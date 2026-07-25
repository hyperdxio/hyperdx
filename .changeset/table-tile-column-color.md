---
"@hyperdx/common-utils": minor
"@hyperdx/app": minor
---

Add per-column color to dashboard table tiles. On builder table tiles you can
now set a static color on a column and layer ordered conditional rules (for
example `> 500` turns the cell red), the table-cell counterpart of the
number-tile color. Rules are authored from the column editor and applied per
cell at render, reusing the existing palette tokens so colors reflow across
light and dark themes.
