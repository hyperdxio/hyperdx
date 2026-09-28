---
'@hyperdx/app': patch
---

fix: keep heatmap tiles on screen while a dashboard refreshes

During a refresh, heatmap tiles replaced the chart with a "Loading..." message
until the new data arrived. They now keep the current heatmap on screen and
pulse while the refetch runs, like the other dashboard tiles.
