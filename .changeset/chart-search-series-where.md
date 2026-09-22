---
'@hyperdx/app': patch
---

fix: carry the clicked series' WHERE condition into a chart's Search action

A builder chart keeps each series' filter in its own `aggCondition`, not in the
statement-level `where`, so a drill-down built from chart-level state alone
spanned every series and its counts didn't reconcile with the clicked line. The
per-series Search now ANDs that series' condition onto the search, and "View all
events" carries the union of every series' condition (the scan scope the chart
itself used).
