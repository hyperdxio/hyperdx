---
'@hyperdx/app': patch
---

fix: draw an isolated dashboard series even when it ranks beyond the line cap

Isolating (or search/checkbox filtering) a time-chart series that sits beyond the per-chart line-render cap left the chart empty, because the cap was applied before the selection filter. The selection now wins over the cap, so an explicitly chosen series always renders, and an oversized manual selection is still bounded by the cap.
