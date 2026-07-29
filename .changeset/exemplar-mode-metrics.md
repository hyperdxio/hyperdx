---
"@hyperdx/common-utils": minor
"@hyperdx/api": minor
"@hyperdx/app": minor
---

feat: add exemplar overlay for metric and PromQL charts

Time charts on metric and PromQL sources can now overlay exemplars —
individual data points linked to a trace — via the "Exemplars" toggle in the
chart editor (next to "As Ratio" for metric charts, in the PromQL editor for
PromQL charts). Each marker sits at the trace's own measurement rather than on
the series line, so its height matches what the linked trace reports; hovering a
marker shows trace metadata (service, span, duration, status) from a
configurable exemplar trace source, with a button to open the trace directly.

Markers are sampled the way Grafana samples exemplars: bucketed at the chart's
granularity, keeping the slowest trace in each bucket plus any further trace
more than 2σ below it, with the marker budget spread evenly across the time
range. The overlay therefore shows the shape of the latency distribution
instead of tracing the top of the chart.

For structured metric sources, exemplars are read directly from the OTel metric
tables' `Exemplars.*` columns (`renderMetricExemplarsChartConfig`), honoring the
chart's time range, metric name, and filters. For PromQL sources backed by a
real Prometheus endpoint, the new `/v1/prometheus/query_exemplars` route proxies
to Prometheus's native `/api/v1/query_exemplars`. The overlay is opt-in and runs
its query in parallel only when enabled, so charts that don't use it are
unaffected. Trace-source exemplar generation lands in a follow-up.

The overlay is off by default for the whole deployment and is enabled with
`NEXT_PUBLIC_ENABLE_EXEMPLARS=true`; with it unset, the chart-editor toggle is
hidden and no exemplar query runs even for charts that have the flag saved.
