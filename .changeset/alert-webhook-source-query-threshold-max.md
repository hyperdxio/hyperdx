---
'@hyperdx/api': patch
---

Fix `{{sourceQuery}}` returning empty for inline-query and dashboard-tile
alerts. It read only the saved search's filter, so alerts backed by a chart
config — where the query lives on the alert or the tile — advertised a variable
that never rendered. It now resolves the query from whichever config backs the
alert: the builder `where` or the raw `sqlTemplate`.

Add `{{thresholdMax}}`, the upper bound of a `between` / `outside` condition.
Receivers previously saw only the lower bound and could not reconstruct the
range that fired. It renders empty for every other comparator.
