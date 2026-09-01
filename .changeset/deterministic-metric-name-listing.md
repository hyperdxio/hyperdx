---
'@hyperdx/app': patch
'@hyperdx/common-utils': patch
---

fix: metric names in the chart editor are now listed deterministically instead of sampled. The dropdown discovered names with `groupUniqArray(3000)(MetricName)`, which keeps an arbitrary subset once a metrics table holds more than 3000 distinct names — the survivors follow hash order, not name order — so metrics that exist and are actively reporting could be unselectable, with no warning and no way to search for what had been dropped. Names are now fetched with an ordered, paginated query and matched server-side, ranked so an exact match is always on the first page, and the dropdown says when the list is incomplete. Also fixes the metric list ignoring the chart's selected time range, which pinned it to the last 24 hours.
