---
'@hyperdx/app': patch
---

feat: auto-fill metric table dropdowns when creating a Metrics source

The 5 metric-table dropdowns (Gauge, Histogram, Sum, Summary, Exponential
Histogram) now auto-populate by matching table names in the selected database
to their metric type via suffix patterns. Prefers `otel_metrics_` prefixed
names, never overwrites user selections, and shows a green notification on
successful autofill.
