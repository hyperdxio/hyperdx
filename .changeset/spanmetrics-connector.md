---
'@hyperdx/otel-collector': minor
'@hyperdx/api': minor
---

feat: derive request metrics with trace exemplars from spans

Adds the OpenTelemetry `spanmetricsconnector` to the collector build and wires
it into the generated OpAMP config behind `ENABLE_SPAN_METRICS`, off by default.
The connector reads the traces pipeline and feeds a dedicated metrics pipeline,
so `traces.span.metrics.*` land in ClickHouse with `Exemplars.*` pointing back
at the spans they were measured from.

Histogram buckets are exponential rather than a fixed ladder: an explicit ladder
puts everything slow into one wide top bucket, so a high quantile interpolates
well past the slowest real request and no exemplar can sit on the plotted line.

Dimensions are limited to `http.route`, `http.request.method` and
`http.response.status_code` — each bounded by the application's route table or
by the HTTP spec — and the connector is given an explicit
`aggregation_cardinality_limit`. Temporality is cumulative, so nothing evicts a
series once created; one free-form dimension would grow collector memory and the
ClickHouse write volume without bound.

`ENABLE_SPAN_METRICS_PROM_RW` additionally remote-writes the derived metrics to
a Prometheus endpoint, for exercising Prometheus's native exemplar path. Because
the generated config is served from the unauthenticated OpAMP endpoint, an
endpoint URL carrying `user:token@` credentials is rejected rather than inlined,
as are non-HTTP schemes. Resource attributes are not promoted to labels on this
exporter: that happens after the connector's cardinality limit and would send
host, pod and namespace to a third party.

Requires a collector built from the current `builder-config.yaml`. Roll the
collector image out before enabling the flag: a config naming a component type
the binary does not register fails to decode as a whole, and the shipped
`docker/otel-collector/config.yaml` defines no pipelines of its own, so a
rejected remote config leaves the collector with nothing to run.
