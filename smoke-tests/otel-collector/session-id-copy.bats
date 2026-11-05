#!/usr/bin/env bats

# transform/session_id copies the old @hyperdx/browser `rum.sessionId`
# resource attribute into the OTel `session.id` attribute on spans, logs and
# replay rows. An existing `session.id` is never overwritten.

load 'test_helpers/utilities.bash'
load 'test_helpers/assertions.bash'

@test "session id copy: spans get session.id from rum.sessionId" {
    emit_otel_data "http://localhost:4318" "data/session-id-copy/spans" "traces"
    wait_for_rows 9000 "SELECT count() FROM otel_traces WHERE ResourceAttributes['suite-id'] = 'session-id-copy' AND ResourceAttributes['test-id'] = 'spans'" 3
    assert_test_data "data/session-id-copy/spans"
}

@test "session id copy: logs get session.id from rum.sessionId, own and JSON body values win" {
    emit_otel_data "http://localhost:4318" "data/session-id-copy/logs"
    wait_for_rows 9000 "SELECT count() FROM otel_logs WHERE ResourceAttributes['suite-id'] = 'session-id-copy' AND ResourceAttributes['test-id'] = 'logs'" 5
    assert_test_data "data/session-id-copy/logs"
}

@test "session id copy: replay rows in hyperdx_sessions get session.id from rum.sessionId" {
    emit_otel_data "http://localhost:4318" "data/session-id-copy/replay"
    wait_for_rows 9000 "SELECT count() FROM hyperdx_sessions WHERE ResourceAttributes['suite-id'] = 'session-id-copy' AND ResourceAttributes['test-id'] = 'replay'" 2
    assert_test_data "data/session-id-copy/replay"
}
