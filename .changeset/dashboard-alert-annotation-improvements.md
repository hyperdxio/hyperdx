---
"@hyperdx/app": patch
---

fix(dashboards): make alert annotations easier to read and keep the "already firing" marker on-screen at sub-minute granularity

Alert firing/recovery annotations on dashboard tiles now float their "Alert" /
"OK" labels in reserved headroom above the marker line — added only on tiles
that are showing annotations — so the labels stay clear of dense series and
stacked bars. Also fixes a case where the marker for an alert that was already
firing when the window opened could be dropped on tiles using a sub-minute
granularity (non-minute-aligned start): the marker now snaps to the chart's
visible left edge instead of falling outside the plot.
