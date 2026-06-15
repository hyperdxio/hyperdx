---
'@hyperdx/common-utils': patch
'@hyperdx/app': patch
---

feat(charts): the time-chart series limit is now configured per chart in the Display Settings drawer instead of as a workspace-wide team setting (the team "Time Chart Series Limit" setting is removed). It is disabled by default — charts fetch every series and no `__hdx_series_limit` CTE is emitted — and is cleared back to disabled by emptying the field. The control only appears for builder line/bar charts; the limit and its Generated SQL preview now come from the chart's own config. When a limit is set, chunked time-chart queries keep a consistent top-N series set: previously each time-window chunk ranked its own top-N, so charts could render more series than the limit and adjacent windows disagreed; the ranking is now pinned to the newest chunk window for every chunk so the union across chunks equals the limit.
