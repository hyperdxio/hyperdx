---
'@hyperdx/common-utils': minor
'@hyperdx/api': minor
---

Add a new `inline` alert source that persists its own chart config directly on the alert, so alerts no longer require a saved search (logs) or a dashboard tile (metrics). The config is the same shape a dashboard tile stores — builder configs on log/trace/metric sources plus raw SQL (Line/Stacked Bar/Number display types); PromQL is rejected. The internal alerts API accepts and returns the new source, and the check-alerts task evaluates inline alerts through the same code path as tile alerts (including group-by and multi-window behavior). Notifications for inline alerts link to the chart explorer seeded with the alert's config over the alerting window, and default their title to the config's name. Backend only — the creation/edit UI and external API v2 support land separately.
