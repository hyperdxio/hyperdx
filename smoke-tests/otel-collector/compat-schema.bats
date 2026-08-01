#!/usr/bin/env bats

load 'test_helpers/utilities.bash'
load 'test_helpers/assertions.bash'

@test "compat schema should use bloom_filter indexes instead of full text on ClickHouse < 26.2" {
    assert_test_data_compat "data/compat-schema/index-types"
}

@test "compat schema should insert and query log data correctly" {
    emit_otel_data "http://localhost:24318" "data/compat-schema/basic-insert"
    sleep 3
    assert_test_data_compat "data/compat-schema/basic-insert"
}
