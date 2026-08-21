---
'@hyperdx/api': patch
---

Tile alerts on metric charts with formulas now evaluate the formula value instead of the last raw operand series: the alert task previously dropped `formulas`/`showOperandSeries` when rebuilding the tile's chart config, so an alert on a formula tile compared the threshold against a raw operand (e.g. bytes) rather than the derived value. Grouped ratio tile alerts also now honor `ratioMode` (`share_of_total` previously evaluated as `per_group`).
