#!/usr/bin/env bats

load 'test_helpers/utilities.bash'
load 'test_helpers/assertions.bash'

setup_file() {
    validate_env
    docker compose up --build --detach
    wait_for_ready "otel-collector"
}

teardown_file() {
    attempt_env_cleanup
}

@test "should infer fatal log level" {
    emit_otel_data "http://localhost:4318" "data/hdx-1514-inference/infer-fatal"
    sleep 1
    assert_test_data "data/hdx-1514-inference/infer-fatal"
}

@test "should infer error log level" {
    emit_otel_data "http://localhost:4318" "data/hdx-1514-inference/infer-error"
    sleep 1
    assert_test_data "data/hdx-1514-inference/infer-error"
}

@test "should infer warn log level" {
    emit_otel_data "http://localhost:4318" "data/hdx-1514-inference/infer-warn"
    sleep 1
    assert_test_data "data/hdx-1514-inference/infer-warn"
}

@test "should infer debug log level" {
    emit_otel_data "http://localhost:4318" "data/hdx-1514-inference/infer-debug"
    sleep 1
    assert_test_data "data/hdx-1514-inference/infer-debug"
}

@test "should infer trace log level" {
    emit_otel_data "http://localhost:4318" "data/hdx-1514-inference/infer-trace"
    sleep 1
    assert_test_data "data/hdx-1514-inference/infer-trace"
}

@test "should infer info log level" {
    emit_otel_data "http://localhost:4318" "data/hdx-1514-inference/infer-info"
    sleep 1
    assert_test_data "data/hdx-1514-inference/infer-info"
}

@test "should skip inference if severity values are defined on the input" {
    emit_otel_data "http://localhost:4318" "data/hdx-1514-inference/skip-infer"
    sleep 1
    assert_test_data "data/hdx-1514-inference/skip-infer"
}
