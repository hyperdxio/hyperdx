---
'@hyperdx/otel-collector': patch
---

fix(otel-collector): only enable the prometheus remote-write exporter in
standalone mode when `CLICKHOUSE_PROMETHEUS_METRICS_ENDPOINT` is set

The standalone collector config used to unconditionally declare a
`prometheusremotewrite` exporter and a `metrics/promql` pipeline. When
`CLICKHOUSE_PROMETHEUS_METRICS_ENDPOINT` was unset the exporter rendered
with an empty endpoint and every metrics batch failed to export.

The exporter and pipeline have been moved to
`docker/otel-collector/config.standalone.promql.yaml`, which is now only
loaded by `entrypoint.sh` when `CLICKHOUSE_PROMETHEUS_METRICS_ENDPOINT` is
non-empty. This mirrors the OpAMP-managed gating in
`packages/api/src/opamp/controllers/opampController.ts` (which already
only adds the exporter when `IS_PROMQL_ENABLED` is true).

No action required if `CLICKHOUSE_PROMETHEUS_METRICS_ENDPOINT` is set; the
behavior is unchanged. If it was unset, the collector now stops emitting
the failing prometheus-remote-write attempts.
