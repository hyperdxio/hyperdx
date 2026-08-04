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
external dashboards API round-trips the per-tile series limit as a positive-only
value across tile types, so a GET → PUT of a tile whose limit is unset (or set
to the "unlimited" 0) is no longer rejected by the write schema.
