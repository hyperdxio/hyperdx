---
"@hyperdx/app": patch
---

feat(charts): clicking a time-chart point now locks the tooltip in place instead of opening a separate drill-down menu. Hovering shows a passive tooltip (timestamp header, series swatches, values, previous-period percent change, nearest-series emphasis) and clicking locks a matching tooltip in place that reveals the drill-down actions inline ("View All Events" plus a per-series Search/Copy/Focus cluster) and a close (X) button in the header. The hover and pinned tooltips share the same building blocks (header, series rows, container) so they stay visually aligned. recharts' own tooltip is kept only for its synced cursor. Dismiss the pinned tooltip via the X, clicking anywhere else, or pressing Escape. The tooltip renders in a portal so it is never clipped by surrounding layout.
