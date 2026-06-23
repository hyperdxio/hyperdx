---
'@hyperdx/app': minor
'@hyperdx/common-utils': minor
---

feat(dashboards): add a background trend sparkline to number tiles

Number tiles can now render a faint line or area sparkline behind the value,
derived from a time-bucketed version of the same query, so the value's trend
over the selected range is visible at a glance. This is handy for SLO /
error-budget tiles where the burn over time matters as much as the current
number. The sparkline inherits the tile's color by default and can be
overridden to any palette token. Configure it under Display Settings >
Background chart on a number tile. Available on builder number tiles (raw SQL
number tiles return a single value with no time dimension to bucket).
