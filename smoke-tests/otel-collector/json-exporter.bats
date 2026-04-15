#!/usr/bin/env bats

load 'test_helpers/utilities.bash'
load 'test_helpers/assertions.bash'

@test "HDX-3994: JSON exporter creates otel_logs table with JSON column types for ResourceAttributes and LogAttributes" {
    assert_test_data "data/json-exporter/column-types"
}

@test "HDX-3994: JSON exporter inserts log data with attributes accessible via JSON path" {
    emit_otel_data "http://localhost:14318" "data/json-exporter/basic-insert"
    sleep 2
    assert_test_data "data/json-exporter/basic-insert"
}
