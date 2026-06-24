#!/usr/bin/env bats

# Exercises the routing/logs connector that splits the logs pipeline:
# log records carrying an `rr-web.event` attribute are routed to
# logs/out-rrweb -> clickhouse/rrweb (the hyperdx_sessions table), while all
# other logs fall through to logs/out-default -> clickhouse (otel_logs).
#
# Prior to this the routing connector and the rrweb (session replay) exporter
# path were never exercised by the smoke suite.

load 'test_helpers/utilities.bash'
load 'test_helpers/assertions.bash'

@test "rrweb routing: rr-web.event logs go to hyperdx_sessions, others go to otel_logs" {
    emit_otel_data "http://localhost:4318" "data/rrweb-routing/route-to-sessions"

    # One record routes to hyperdx_sessions, the other to otel_logs. Wait for
    # both to land before asserting the combined snapshot.
    wait_for_rows 9000 "SELECT count() FROM hyperdx_sessions WHERE ResourceAttributes['suite-id'] = 'rrweb-routing' AND ResourceAttributes['test-id'] = 'route-to-sessions'"
    wait_for_rows 9000 "SELECT count() FROM otel_logs WHERE ResourceAttributes['suite-id'] = 'rrweb-routing' AND ResourceAttributes['test-id'] = 'route-to-sessions'"

    assert_test_data "data/rrweb-routing/route-to-sessions"
}
