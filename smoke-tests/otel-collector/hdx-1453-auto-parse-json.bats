#!/usr/bin/env bats

load 'test_helpers/utilities.bash'
load 'test_helpers/assertions.bash'

setup_file() {
    validate_env
    docker compose up --build --detach
    wait_for_ready "otel-collector" "http://localhost:4318"
}

teardown_file() {
    attempt_env_cleanup
}

@test "JSON string body content should be parsed and stored as log attributes" {
    emit_otel_data "http://localhost:4318" "data/auto-parse/json-string"
    sleep 1
    assert_test_data "data/auto-parse/json-string"
}

@test "OTEL map content should be stored as log attributes" {
    emit_otel_data "http://localhost:4318" "data/auto-parse/otel-map"
    sleep 1
    assert_test_data "data/auto-parse/otel-map"
}

@test "all other content should skip storing values in log attributes" {
    emit_otel_data "http://localhost:4318" "data/auto-parse/default"
    sleep 1
    assert_test_data "data/auto-parse/default"
}
