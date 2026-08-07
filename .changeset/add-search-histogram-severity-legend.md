---
'@hyperdx/app': minor
---

Add a legend below the search histogram showing each series' total across the
entire selected time range, so a breakdown like "how many errors in the last 45
minutes" reads as one number instead of bars to sum by eye. Severity-like groups
are colored semantically and ordered most-severe-first; any other grouping uses
the chart's palette colors ordered by total. Clicking an item narrows the search
to that series.
