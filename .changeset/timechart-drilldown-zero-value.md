---
'@hyperdx/app': patch
---

fix: keep the drill-down value filter when the clicked point is zero

Clicking a time-chart point with a value of exactly 0 dropped the value filter
and searched every event in the bucket instead of the matching ones. Zero is a
real point — the chart deliberately keeps it rather than treating it as absent —
so the guard now tests for a missing value rather than a falsy one.
