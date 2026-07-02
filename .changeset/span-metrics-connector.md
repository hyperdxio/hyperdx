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
