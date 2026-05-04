#!/usr/bin/env bats

load 'test_helpers/utilities.bash'
load 'test_helpers/assertions.bash'

@test "HDX-1514: should infer fatal log level" {
    emit_otel_data "http://localhost:4318" "data/severity-inference/infer-fatal"
    sleep 1
    assert_test_data "data/severity-inference/infer-fatal"
}

@test "HDX-1514: should infer error log level" {
    emit_otel_data "http://localhost:4318" "data/severity-inference/infer-error"
    sleep 1
    assert_test_data "data/severity-inference/infer-error"
}

@test "HDX-1514: should infer warn log level" {
    emit_otel_data "http://localhost:4318" "data/severity-inference/infer-warn"
    sleep 1
    assert_test_data "data/severity-inference/infer-warn"
}

@test "HDX-1514: should infer debug log level" {
    emit_otel_data "http://localhost:4318" "data/severity-inference/infer-debug"
    sleep 1
    assert_test_data "data/severity-inference/infer-debug"
}

@test "HDX-1514: should infer trace log level" {
    emit_otel_data "http://localhost:4318" "data/severity-inference/infer-trace"
    sleep 1
    assert_test_data "data/severity-inference/infer-trace"
}

@test "HDX-1514: should infer info log level" {
    emit_otel_data "http://localhost:4318" "data/severity-inference/infer-info"
    sleep 1
    assert_test_data "data/severity-inference/infer-info"
}

@test "HDX-1514: should skip inference if severity values are defined on the input" {
    emit_otel_data "http://localhost:4318" "data/severity-inference/skip-infer"
    sleep 1
    assert_test_data "data/severity-inference/skip-infer"
}

@test "should not infer severity from keywords embedded mid-word" {
    emit_otel_data "http://localhost:4318" "data/severity-inference/no-infer-substring"
    sleep 1
    assert_test_data "data/severity-inference/no-infer-substring"
}

@test "should infer severity from superstring keywords like WARNING and CRITICAL" {
    emit_otel_data "http://localhost:4318" "data/severity-inference/infer-superstring"
    sleep 1
    assert_test_data "data/severity-inference/infer-superstring"
}
