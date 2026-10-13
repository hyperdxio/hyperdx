#!/usr/bin/env bats

load 'test_helpers/utilities.bash'
load 'test_helpers/assertions.bash'

@test "HDX-1453: JSON string body content should be parsed and stored as log attributes" {
    emit_otel_data "http://localhost:4318" "data/auto-parse/json-string"
    sleep 1
    assert_test_data "data/auto-parse/json-string"
}

@test "HDX-1453: OTEL map content should be stored as log attributes" {
    emit_otel_data "http://localhost:4318" "data/auto-parse/otel-map"
    sleep 1
    assert_test_data "data/auto-parse/otel-map"
}

@test "HDX-1453: all other content should skip storing values in log attributes" {
    emit_otel_data "http://localhost:4318" "data/auto-parse/default"
    sleep 1
    assert_test_data "data/auto-parse/default"
}

@test "brace-delimited non-JSON bodies are not merged and don't log parse errors" {
    emit_otel_data "http://localhost:4318" "data/auto-parse/brace-not-json"
    wait_for_rows 9000 "SELECT count() FROM otel_logs WHERE ResourceAttributes['suite-id'] = 'auto-parse' AND ResourceAttributes['test-id'] = 'brace-not-json'" 5
    assert_test_data "data/auto-parse/brace-not-json"

    run docker compose logs otel-collector
    [ "$status" -eq 0 ]
    # Prove we read the collector's output before asserting what's absent from it.
    [[ "$output" == *"Everything is ready"* ]]
    [[ "$output" != *"invalid character"* ]]
    [[ "$output" != *"ParseJSON"* ]]
}

@test "JSON objects with whitespace after the opening brace are parsed" {
    emit_otel_data "http://localhost:4318" "data/auto-parse/json-whitespace"
    wait_for_rows 9000 "SELECT count() FROM otel_logs WHERE ResourceAttributes['suite-id'] = 'auto-parse' AND ResourceAttributes['test-id'] = 'json-whitespace'" 3
    assert_test_data "data/auto-parse/json-whitespace"
}
