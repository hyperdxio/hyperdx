---
'@hyperdx/app': patch
---

feat(dashboards): add background area sparklines to the Browser RUM dashboard
number tiles. Each of the ten single-value tiles (LCP / INP / CLS p75, Median
and p90 Page Load, Page Views, Active Sessions, Sessions w/ Errors, JS Errors,
AJAX Errors) now renders a faint trend line behind its value so the metric's
movement over the selected range is visible at a glance. Implemented entirely
via the existing number-tile `backgroundChart` field — no renderer changes.
