---
'@hyperdx/app': minor
---

Add a metrics explorer to the chart editor, so you no longer have to already know a metric's name to chart it. A browse control beside the metric select opens a modal with a prefix hierarchy over the metric namespace — `system` → `cpu` → `utilization` — plus search across every name and description the source is reporting. Each row carries the metric's kind and its description, and the detail pane shows the unit (rendered from its UCUM code), reporting services, and tag keys drilling into their values. Previously the picker was a flat 3,000-entry dropdown and that metadata only appeared after you had already committed to a metric.

Names are split per metric: on `.` when the name has one (OpenTelemetry), otherwise on `_` (Prometheus exporters). Deciding per name rather than per source matters in practice — a real deployment carries thousands of underscore-style collector self-telemetry names alongside dozens of dotted application metrics, and a single source-wide separator flattened whichever family was outnumbered. Single-child chains collapse so the tree does not become a corridor, and the unfiltered tree is never truncated, so no namespace can go missing.

While browsing a metric's tags you can stage filters and group-bys the same way the chart editor's inline attribute panel allows; they are shown as removable chips and applied together with the metric. Applying also sets an aggregation appropriate to the kind — average for a gauge, sum for a counter, p95 for a histogram — instead of inheriting whatever the previous series used. Both replace rather than merge, since they were written against the newly chosen metric: staged filters replace the series condition, and staged group-bys replace the chart's.

The chart editor's inline attribute panel now also shows the metric's kind. Only chartable kinds are listed (gauge, sum, histogram, exponential histogram); `summary` is omitted because the query renderer cannot translate it. The browser is a self-contained component, so the modal is one shell around it rather than the only possible home.
