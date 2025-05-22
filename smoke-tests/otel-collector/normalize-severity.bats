#!/usr/bin/env bats

load 'test_helpers/utilities.bash'
load 'test_helpers/assertions.bash'

@test "HDX-1422: normalize the text case for severity text" {
    emit_otel_data "http://localhost:4318" "data/normalize-severity/text-case"
    sleep 1
    assert_test_data "data/normalize-severity/text-case"
}