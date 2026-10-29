#!/usr/bin/env bats

load 'test_helpers/utilities.bash'
load 'test_helpers/assertions.bash'
load 'test_helpers/oidc_fixture.bash'

# Must match docker-compose.yaml's otel-collector-oidc OIDC_ISSUER_URL/AUDIENCE.
OIDC_TEST_ISSUER="http://otel-collector-oidc-mock:8080"
OIDC_TEST_AUDIENCE="smoke-test-audience"
OIDC_FIXTURE_DIR="$(cd "$(dirname "$BATS_TEST_FILENAME")" && pwd)/data/oidc-auth"

@test "OIDC: a request with a valid, correctly-signed token is accepted and lands in ClickHouse" {
    local token
    token=$(mint_oidc_jwt "$OIDC_FIXTURE_DIR" "$OIDC_TEST_ISSUER" "$OIDC_TEST_AUDIENCE")

    run curl -s -o /dev/null -w "%{http_code}" -X POST "http://localhost:44318/v1/logs" \
        -H "Authorization: Bearer $token" \
        -H "Content-Type: application/json" \
        --data @"$OIDC_FIXTURE_DIR/valid-token/input.json"
    [ "$status" -eq 0 ]
    [ "$output" = "200" ]

    sleep 1
    assert_test_data "$OIDC_FIXTURE_DIR/valid-token"
}

@test "OIDC: a request with no Authorization header is rejected" {
    run curl -s -o /dev/null -w "%{http_code}" -X POST "http://localhost:44318/v1/logs" \
        -H "Content-Type: application/json" \
        --data '{"resourceLogs":[]}'
    [ "$status" -eq 0 ]
    [ "$output" != "200" ]
}

@test "OIDC: a request with a garbage bearer token is rejected" {
    run curl -s -o /dev/null -w "%{http_code}" -X POST "http://localhost:44318/v1/logs" \
        -H "Authorization: Bearer not-a-real-jwt" \
        -H "Content-Type: application/json" \
        --data '{"resourceLogs":[]}'
    [ "$status" -eq 0 ]
    [ "$output" != "200" ]
}

@test "OIDC: a request with a token signed for the wrong audience is rejected" {
    local token
    token=$(mint_oidc_jwt "$OIDC_FIXTURE_DIR" "$OIDC_TEST_ISSUER" "some-other-audience")

    run curl -s -o /dev/null -w "%{http_code}" -X POST "http://localhost:44318/v1/logs" \
        -H "Authorization: Bearer $token" \
        -H "Content-Type: application/json" \
        --data '{"resourceLogs":[]}'
    [ "$status" -eq 0 ]
    [ "$output" != "200" ]
}

@test "OIDC: collector fails fast with a clear error when OIDC_AUDIENCE is missing" {
    run docker compose logs otel-collector-oidc-missing-audience
    [ "$status" -eq 0 ]
    [[ "$output" == *"OIDC_ISSUER_URL is set but OIDC_AUDIENCE is not"* ]]

    # It should have exited rather than staying up like a normal collector.
    run docker compose ps --status running --services
    [ "$status" -eq 0 ]
    [[ "$output" != *"otel-collector-oidc-missing-audience"* ]]
}
