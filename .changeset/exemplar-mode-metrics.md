---
"@hyperdx/common-utils": minor
"@hyperdx/api": minor
"@hyperdx/app": minor
---

feat: add exemplar overlay for metric and PromQL charts

Time charts on metric and PromQL sources can now overlay exemplars —
individual data points linked to a trace — via the "Exemplars" toggle in the
chart editor (next to "As Ratio" for metric charts, in the PromQL editor for
PromQL charts). Markers snap onto the series line so the chart stays honest;
hovering a marker shows trace metadata (service, span, duration, status) from a
configurable exemplar trace source, with a button to open the trace directly.

For structured metric sources, exemplars are read directly from the OTel metric
tables' `Exemplars.*` columns (`renderMetricExemplarsChartConfig`), honoring the
chart's time range, metric name, and filters. For PromQL sources backed by a
real Prometheus endpoint, the new `/v1/prometheus/query_exemplars` route proxies
to Prometheus's native `/api/v1/query_exemplars`. The overlay is opt-in and runs
its query in parallel only when enabled, so charts that don't use it are
unaffected. Trace-source exemplar generation lands in a follow-up.
