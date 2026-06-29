---
"@hyperdx/app": patch
---

fix(dashboards): match the number-tile background sparkline to the displayed value

The big number on a number tile is a single aggregate (its query drops `groupBy`), but the background sparkline kept any `groupBy` the tile carried over from a prior Line display type. It then plotted only the first group's trend behind a value that aggregates every group. The sparkline now drops `groupBy` as well, so its trend reflects the same single series as the value it sits behind.
