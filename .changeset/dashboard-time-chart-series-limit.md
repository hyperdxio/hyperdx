---
'@hyperdx/common-utils': minor
'@hyperdx/app': minor
'@hyperdx/api': minor
---

Cap high-cardinality time-chart series to protect the browser from rendering
thousands of lines at once. Time charts now materialize and draw a bounded
number of series per tile, with escape hatches to reveal the rest on demand: a
"+N more" affordance in the hover and pinned tooltips, and a "load all series"
action that lifts the cap for a chart. Tooltips also cap how many rows they
render per frame so a wide bucket can't mount thousands of popovers. The
external dashboards API exposes the per-tile series limit as a three-state value
across tile types — omit for the default cap, 0 for unlimited, or a positive N
for the top N
