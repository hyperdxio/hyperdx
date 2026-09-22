---
'@hyperdx/app': patch
---

fix: keep Y-axis ticks evenly spaced and cleanly rounded

A chart's Y-axis could render unevenly spaced or fractional ticks (e.g. `0, 300, 1k` instead of `0, 250, 500, 750, 1k`). Ticks now round to clean, evenly-spaced values instead.
