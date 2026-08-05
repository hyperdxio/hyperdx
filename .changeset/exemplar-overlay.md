---
'@hyperdx/common-utils': minor
'@hyperdx/app': minor
---

feat: exemplar overlay for metric and PromQL time charts

Time charts on metric and PromQL sources can overlay exemplars — individual
trace-linked data points — via the "Exemplars" toggle in the chart editor.
Hovering a marker shows the exemplar's own value and time plus trace metadata
from a configurable trace source, with a button to open the trace.

Off by default for the whole deployment behind `NEXT_PUBLIC_ENABLE_EXEMPLARS`,
and per-chart behind `enableExemplars`.

Markers are sampled the way Grafana samples them: bucketed at the chart's
granularity, keeping the slowest trace in each bucket plus any further trace more
than 2σ below it. The overlay shows the shape of the latency distribution rather
than tracing the top of the chart.

A marker sits at the trace's own measurement, so it is only shown where that is
honest: a single non-ratio histogram series with no group by, aggregated in a way
that leaves the axis on the observation scale, and for PromQL an expression that
plots a duration. Markers outside the rendered window, or below a fitted y-axis
floor, are dropped rather than moved — and the count is surfaced on the chart.
