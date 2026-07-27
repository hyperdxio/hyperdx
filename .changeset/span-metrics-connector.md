---
"@hyperdx/api": minor
"@hyperdx/otel-collector": minor
---

feat: optional spanmetrics connector for metric exemplars

Adds the `spanmetricsconnector` to the collector build and wires it into the
OpAMP-generated collector config, gated on the `ENABLE_SPAN_METRICS` env flag
(off by default). When enabled, the collector derives `traces.span.metrics.*`
(calls + duration histogram) from spans with **exemplars enabled**, so the
duration histogram lands in ClickHouse with `Exemplars.*` pointing back at the
spans they were measured from — giving coherent, fully-OTLP metric exemplars
without any direct ClickHouse writes. Enabled in local dev to back the new
`telemetry-generator` service.

The duration histogram uses exponential (OTLP) buckets rather than a fixed
ladder, so it lands in `otel_metrics_exponential_histogram` and remote-writes
to Prometheus as a native histogram. A fixed ladder's wide top bucket makes
high quantiles interpolate well past the slowest request that actually
happened — a p99 reading 10s off a 5s–10s bucket when nothing took longer than
6s — which no exemplar can ever sit on. Exemplar overlays now accept
exponential histograms alongside explicit-bucket ones.
