#!/usr/bin/env bats

# HDX-4664: the schema seed supports the Replicated (DatabaseReplicated)
# database engine. The ch-server-replicated service boots with an empty Atomic
# `default` database (ClickHouse's own bootstrap), so these tests also cover
# the seed's Atomic -> Replicated conversion path used when the collector
# starts before clickhouse-operator's enableDatabaseSync.

load 'test_helpers/utilities.bash'
load 'test_helpers/assertions.bash'

@test "replicated schema should create the database and tables with Replicated engines" {
    assert_test_data_replicated "data/replicated-schema/engines"
}

@test "replicated schema should insert and query log data correctly" {
    emit_otel_data "http://localhost:54318" "data/replicated-schema/basic-insert"
    wait_for_rows 39000 "SELECT count() FROM otel_logs WHERE ResourceAttributes['suite-id'] = 'replicated-schema' AND ResourceAttributes['test-id'] = 'basic-insert'" 2
    assert_test_data_replicated "data/replicated-schema/basic-insert"
}
