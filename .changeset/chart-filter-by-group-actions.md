---
"@hyperdx/app": patch
---

feat(charts): add per-series actions to the chart drill-down menu. Each series in the "Filter by group" list now shows its legend color swatch and offers icon actions with tooltips: Drill in (opens the underlying events in a new tab), Copy name (copies the series name to the clipboard), and Focus (narrows the view to that series). "View All Events" and "Drill in" now open in a new tab so the current view is preserved. On the search page, Focus applies the series as a real search filter so both the chart and the results list narrow together (previously it only isolated the line on the chart, leaving the results unchanged); standalone charts fall back to the prior chart-only visual focus.
