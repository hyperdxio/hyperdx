#!/usr/bin/env bats

# Static bearer-token auth (config.standalone.auth.yaml): the OTLP receiver
# must accept both the bare-token and `Bearer `-prefixed Authorization forms,
# including scheme case variants.

load 'test_helpers/utilities.bash'
load 'test_helpers/assertions.bash'

# Must match docker-compose.yaml's otel-collector-bearer-auth OTLP_AUTH_TOKEN.
OTLP_TEST_TOKEN="smoke-test-bearer-token"
BEARER_AUTH_ENDPOINT="http://localhost:54318"
BEARER_AUTH_FIXTURE_DIR="$(cd "$(dirname "$BATS_TEST_FILENAME")" && pwd)/data/bearer-auth"

post_logs_with_auth() {
    local auth_value=$1
    local datafile=$2
    curl -s -o /dev/null -w "%{http_code}" -X POST "$BEARER_AUTH_ENDPOINT/v1/logs" \
        -H "Authorization: $auth_value" \
        -H "Content-Type: application/json" \
        --data @"$datafile"
}

# Status-only variant: sends an empty (but valid) OTLP payload so auth is
# exercised without inserting rows that would skew the snapshot assertions.
post_empty_logs_with_auth() {
    local auth_value=$1
    curl -s -o /dev/null -w "%{http_code}" -X POST "$BEARER_AUTH_ENDPOINT/v1/logs" \
        -H "Authorization: $auth_value" \
        -H "Content-Type: application/json" \
        --data '{"resourceLogs":[]}'
}

@test "bearer auth: a bare token is accepted and lands in ClickHouse" {
    run post_logs_with_auth "$OTLP_TEST_TOKEN" "$BEARER_AUTH_FIXTURE_DIR/bare-token/input.json"
    [ "$status" -eq 0 ]
    [ "$output" = "200" ]

    wait_for_rows 9000 "SELECT count() FROM bearer_auth.otel_logs WHERE ResourceAttributes['test-id'] = 'bare-token'" 1
    assert_test_data "$BEARER_AUTH_FIXTURE_DIR/bare-token"
}

@test "bearer auth: a 'Bearer '-prefixed token is accepted and lands in ClickHouse" {
    run post_logs_with_auth "Bearer $OTLP_TEST_TOKEN" "$BEARER_AUTH_FIXTURE_DIR/bearer-prefixed/input.json"
    [ "$status" -eq 0 ]
    [ "$output" = "200" ]

    wait_for_rows 9000 "SELECT count() FROM bearer_auth.otel_logs WHERE ResourceAttributes['test-id'] = 'bearer-prefixed'" 1
    assert_test_data "$BEARER_AUTH_FIXTURE_DIR/bearer-prefixed"
}

@test "bearer auth: a lowercase 'bearer '-prefixed token is accepted" {
    run post_empty_logs_with_auth "bearer $OTLP_TEST_TOKEN"
    [ "$status" -eq 0 ]
    [ "$output" = "200" ]
}

@test "bearer auth: an uppercase 'BEARER '-prefixed token is accepted" {
    run post_empty_logs_with_auth "BEARER $OTLP_TEST_TOKEN"
    [ "$status" -eq 0 ]
    [ "$output" = "200" ]
}

@test "bearer auth: a request with a wrong bare token is rejected" {
    run post_empty_logs_with_auth "not-the-token"
    [ "$status" -eq 0 ]
    [ "$output" != "200" ]
}

@test "bearer auth: a request with a wrong Bearer-prefixed token is rejected" {
    run post_empty_logs_with_auth "Bearer not-the-token"
    [ "$status" -eq 0 ]
    [ "$output" != "200" ]
}

@test "bearer auth: a request with no Authorization header is rejected" {
    run curl -s -o /dev/null -w "%{http_code}" -X POST "$BEARER_AUTH_ENDPOINT/v1/logs" \
        -H "Content-Type: application/json" \
        --data '{"resourceLogs":[]}'
    [ "$status" -eq 0 ]
    [ "$output" != "200" ]
}
