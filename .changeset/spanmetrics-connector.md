---
'@hyperdx/otel-collector': minor
'@hyperdx/api': minor
---

feat: derive request metrics with trace exemplars from spans

Adds the OpenTelemetry `spanmetricsconnector` to the collector build and wires it
into the generated OpAMP config behind `ENABLE_SPAN_METRICS`, off by default. The
connector reads the traces pipeline and feeds a dedicated metrics pipeline, so
`traces.span.metrics.*` land in ClickHouse with `Exemplars.*` pointing back at the
spans they were measured from.

Histogram buckets are exponential rather than a fixed ladder: an explicit ladder
puts everything slow into one wide top bucket, so a high quantile interpolates well
past the slowest real request and no exemplar can sit on the plotted line.

`ENABLE_SPAN_METRICS_PROM_RW` additionally remote-writes the derived metrics to a
Prometheus endpoint, for exercising Prometheus's native exemplar path.

Requires a collector built from the current `builder-config.yaml`. Roll the
collector image out before enabling the flag: a config naming a component type the
binary does not register fails to decode as a whole, and the shipped
`docker/otel-collector/config.yaml` defines no pipelines of its own, so a rejected
remote config leaves the collector with nothing to run.
