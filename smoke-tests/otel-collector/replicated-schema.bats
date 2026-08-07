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

@test "replicated schema should recover fence databases left by an interrupted conversion" {
    # Simulate leftovers from a conversion that crashed between the RENAME and
    # a successful cleanup: an empty fence (junk) and a non-empty fence
    # (stranded table that raced into the database before the crash).
    clickhouse-client --port=39000 --query="CREATE DATABASE IF NOT EXISTS default_pre_replicated_1000000000"
    clickhouse-client --port=39000 --query="CREATE DATABASE IF NOT EXISTS default_pre_replicated_1000000001"
    clickhouse-client --port=39000 --query="CREATE TABLE IF NOT EXISTS default_pre_replicated_1000000001.stranded (x UInt8) ENGINE = MergeTree ORDER BY x"
    clickhouse-client --port=39000 --query="INSERT INTO default_pre_replicated_1000000001.stranded VALUES (1)"

    # Restart the collector so the schema seed's fence recovery runs again.
    docker compose restart otel-collector-replicated

    # The seed drops the empty fence during startup; poll until it is gone
    # (the inverted count flips to 1 once the database no longer exists).
    wait_for_rows 39000 "SELECT count() == 0 FROM system.databases WHERE name = 'default_pre_replicated_1000000000'" 1

    # The non-empty fence must survive with its table intact, and the target
    # database must still be the Replicated one.
    assert_test_data_replicated "data/replicated-schema/fence-recovery"

    # Clean up the preserved fence so the suite is idempotent under
    # SKIP_CLEANUP re-runs.
    clickhouse-client --port=39000 --query="DROP DATABASE default_pre_replicated_1000000001 SYNC"
}
