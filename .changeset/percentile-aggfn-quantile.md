---
'@hyperdx/common-utils': patch
'@hyperdx/api': patch
'@hyperdx/app': patch
---

fix: render percentile aggregations (`p50`, `p90`, `p95`, `p99`) as `quantile`
at the matching level. A chart config with `aggFn: 'p95'` rendered as the
nonexistent ClickHouse function `p95If`. The AI assistant now returns
percentiles with a level instead of a bare `quantile` (median), and v1 metric
chart conversion keeps the percentile level.
