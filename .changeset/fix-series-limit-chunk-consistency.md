---
'@hyperdx/common-utils': patch
'@hyperdx/app': patch
---

fix(charts): group-by time charts could render more series than the configured series limit because each time-window chunk ranked its own top-N; the ranking is now pinned to the newest chunk window so every chunk keeps the same series set. The team "Time Chart Series Limit" setting is now opt-in: it defaults to disabled (charts fetch every series, no limit CTE) and can be disabled again from the team settings page. Also fixes the chart editor's "Generated SQL" preview, which always showed a series limit of 100 instead of the team's configured value.
