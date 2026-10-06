---
'@hyperdx/common-utils': minor
'@hyperdx/app': minor
'@hyperdx/api': patch
---

Support "Minimum auto granularity" on PromQL sources. It floors the step of charts on auto granularity, as it does for metric sources, and `$__rate_interval` now uses it as the source's scrape interval (still 15s when unset) instead of always assuming 15s. A granularity picked on a tile is never changed.
