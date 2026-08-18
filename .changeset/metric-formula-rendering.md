---
'@hyperdx/common-utils': minor
---

Render metric formulas (`formulas` on builder chart configs) in the composed multi-series metric query. Letter-ref expressions like `A / (A + B + C) * 100` compile into the final SELECT projection over the pivoted per-series columns, with ratio-consistent missing-data semantics: a missing operand counts as 0 while a zero or missing division denominator yields NULL (a rendered gap). `showOperandSeries: false` emits only the formula column(s). Works for grouped and ungrouped line, table, and number charts, and single-series charts with a formula now route through the composed query path.
