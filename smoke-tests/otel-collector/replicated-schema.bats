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
    # a successful cleanup: an empty fence (junk), a non-empty fence (stranded
    # table that raced into the database before the crash), and a fence whose
    # only table is detached (invisible in system.tables but still destroyed
    # by DROP DATABASE, so it must count against the emptiness check).
    clickhouse-client --port=39000 --query="CREATE DATABASE IF NOT EXISTS default_pre_replicated_1000000000"
    clickhouse-client --port=39000 --query="CREATE DATABASE IF NOT EXISTS default_pre_replicated_1000000001"
    clickhouse-client --port=39000 --query="CREATE TABLE IF NOT EXISTS default_pre_replicated_1000000001.stranded (x UInt8) ENGINE = MergeTree ORDER BY x"
    clickhouse-client --port=39000 --query="INSERT INTO default_pre_replicated_1000000001.stranded VALUES (1)"
    clickhouse-client --port=39000 --query="CREATE DATABASE IF NOT EXISTS default_pre_replicated_1000000002"
    clickhouse-client --port=39000 --query="CREATE TABLE IF NOT EXISTS default_pre_replicated_1000000002.stranded_detached (x UInt8) ENGINE = MergeTree ORDER BY x"
    clickhouse-client --port=39000 --query="DETACH TABLE default_pre_replicated_1000000002.stranded_detached"

    # Restart the collector so the schema seed's fence recovery runs again.
    docker compose restart otel-collector-replicated

    # The seed drops the empty fence during startup; poll until it is gone
    # (the inverted count flips to 1 once the database no longer exists).
    wait_for_rows 39000 "SELECT count() == 0 FROM system.databases WHERE name = 'default_pre_replicated_1000000000'" 1

    # The non-empty fences must survive (attached table intact, detached
    # table still detached), and the target database must still be the
    # Replicated one.
    assert_test_data_replicated "data/replicated-schema/fence-recovery"

    # Clean up the preserved fences so the suite is idempotent under
    # SKIP_CLEANUP re-runs.
    clickhouse-client --port=39000 --query="DROP DATABASE default_pre_replicated_1000000001 SYNC"
    clickhouse-client --port=39000 --query="DROP DATABASE default_pre_replicated_1000000002 SYNC"
}

@test "replicated schema should warn about pre-existing non-replicated tables" {
    # A plain MergeTree table inside the Replicated database (e.g. created
    # before the conversion by another schema manager) no-ops through the
    # seed's CREATE TABLE IF NOT EXISTS, so its data would silently not
    # replicate. The post-seed audit must call it out on every startup.
    clickhouse-client --port=39000 --query="CREATE TABLE IF NOT EXISTS default.legacy_plain (x UInt8) ENGINE = MergeTree ORDER BY x"
    clickhouse-client --port=39000 --query="INSERT INTO default.legacy_plain VALUES (1)"

    docker compose restart otel-collector-replicated

    # Wait for the restarted seed to finish and emit the audit warning.
    local attempt=0
    until docker compose logs otel-collector-replicated | grep -q 'uses the non-replicated MergeTree engine inside a Replicated database'; do
        attempt=$((attempt + 1))
        if [ "$attempt" -gt 30 ]; then
            echo "❌ Error: audit warning for non-replicated table not found in collector logs" >&3
            return 1
        fi
        sleep 1
    done

    # The audited table must be untouched (never dropped or altered).
    run clickhouse-client --port=39000 --query="SELECT engine, (SELECT count() FROM default.legacy_plain) FROM system.tables WHERE database = 'default' AND name = 'legacy_plain' FORMAT CSV"
    [ "$status" -eq 0 ]
    [ "$output" = '"MergeTree",1' ]

    # Clean up so the suite is idempotent under SKIP_CLEANUP re-runs.
    clickhouse-client --port=39000 --query="DROP TABLE default.legacy_plain SYNC"
}
