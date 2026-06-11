---
'@hyperdx/common-utils': patch
'@hyperdx/app': patch
---

feat(charts): the team "Time Chart Series Limit" setting is now opt-in — it defaults to disabled (charts fetch every series, no limit CTE) and a configured value can be cleared back to disabled from the team settings page. When a limit is set, chunked time-chart queries now keep a consistent top-N series set: previously each time-window chunk ranked its own top-N, so charts could render more series than the limit and adjacent windows disagreed; the ranking is now pinned to the newest chunk window for every chunk. The chart editor's "Generated SQL" preview also reflects the team's configured limit instead of always showing 100.
