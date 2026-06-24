#!/usr/bin/env bats

# Exercises the `metrics` pipeline (otlp/hyperdx -> clickhouse exporter ->
# otel_metrics_gauge). Prior to this the smoke suite only emitted logs, so the
# metric ingest path and otel_metrics_* schema were never verified end-to-end.

load 'test_helpers/utilities.bash'
load 'test_helpers/assertions.bash'

@test "metrics: gauge data points are ingested into otel_metrics_gauge with attributes and values" {
    emit_otel_data "http://localhost:4318" "data/metrics/gauge-insert" "metrics"
    wait_for_rows 9000 "SELECT count() FROM otel_metrics_gauge WHERE ResourceAttributes['suite-id'] = 'metrics' AND ResourceAttributes['test-id'] = 'gauge-insert'"
    assert_test_data "data/metrics/gauge-insert"
}
