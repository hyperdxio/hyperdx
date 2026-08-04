---
'@hyperdx/app': patch
---

Fix the time-chart tooltip: clicking outside the chart now unpins the pinned
tooltip, the pin always stacks above hover tooltips, and a many-series hover
tooltip is clamped to a bounded height instead of overflowing the chart (pin it
to scroll through every series).
