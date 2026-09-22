---
'@hyperdx/app': patch
---

fix: keep Y-axis ticks evenly spaced and cleanly rounded

A chart's Y-axis could render unevenly spaced or fractional ticks (e.g. `0, 300, 1k`, or `0, 341, 683, 1k`) instead of clean, even ones like `0, 250, 500, 750, 1k`. The axis now rounds its range to a "nice" step (1/2/5 × a power of 10, the same idea most charting libraries use) before choosing ticks, so labels land on round numbers and stay evenly spaced. Tick count is unaffected — this only changes which values are chosen.

Also fixed: a stacked bar chart's Y-axis was computing its max from a single series instead of the summed stack height (clipping bars), an all-zero or all-negative chart could get a collapsed or inverted domain, and the axis could scale to a series that isn't even drawn on the chart.
