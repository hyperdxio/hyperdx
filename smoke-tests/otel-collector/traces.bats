#!/usr/bin/env bats

# Exercises the `traces` pipeline (otlp/hyperdx -> clickhouse exporter ->
# otel_traces). Prior to this the smoke suite only emitted logs, so the trace
# ingest path and otel_traces schema were never verified end-to-end.

load 'test_helpers/utilities.bash'
load 'test_helpers/assertions.bash'

@test "traces: spans are ingested into otel_traces with attributes and parent/child linkage" {
    emit_otel_data "http://localhost:4318" "data/traces/basic-insert" "traces"
    # The fixture sends 2 spans (root + child); wait for both so the snapshot
    # assertion never runs against a partially-flushed batch.
    wait_for_rows 9000 "SELECT count() FROM otel_traces WHERE ResourceAttributes['suite-id'] = 'traces' AND ResourceAttributes['test-id'] = 'basic-insert'" 2
    assert_test_data "data/traces/basic-insert"
}
