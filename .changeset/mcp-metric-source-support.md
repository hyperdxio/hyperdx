---
'@hyperdx/api': minor
---

feat(mcp): first-class metric source support

- Two new tools: `clickstack_list_metrics` paginates the metric-name catalog with optional kind / namePattern (ILIKE) / time-window filters and opaque cursor pagination; `clickstack_describe_metric` returns per-metric kind(s), unit, description, attribute keys, and sampled values (with kind auto-detection).
- `clickstack_describe_source` is metric-aware: picks a representative metric table (gauge → sum → histogram), runs column / map-key / value-sampling against it, and adds a per-kind metric-name sample.
- `clickstack_timeseries` and `clickstack_table` accept `metricType` (gauge / sum / histogram), `metricName`, and `isDelta` on each select item, plus `aggFn:"increase"` for Sum counters. `valueExpression` defaults to `"Value"` for metric sources. Surfaces the renderer's 20-group top-N cap on `increase + groupBy` as a neutral hint.
- Dashboard prompt's "use raw SQL for metric tiles" workaround is replaced with positive discovery-workflow guidance and one worked example per supported kind.
- `summary` and `"exponential histogram"` kinds remain out of scope (no query renderer support yet).
