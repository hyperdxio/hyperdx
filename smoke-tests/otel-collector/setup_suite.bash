#!/usr/bin/env bats

load 'test_helpers/utilities.bash'
load 'test_helpers/assertions.bash'
load 'test_helpers/oidc_fixture.bash'

setup_suite() {
    validate_env
    # Must exist before `docker compose up`, since otel-collector-oidc-mock
    # mounts data/oidc-auth/public as its served directory. The issuer URL
    # must match otel-collector-oidc's OIDC_ISSUER_URL in docker-compose.yaml.
    generate_oidc_fixtures "$(pwd)/data/oidc-auth" "http://otel-collector-oidc-mock:8080"
    docker compose up --build --detach
    wait_for_ready "otel-collector"
    wait_for_ready "otel-collector-json"
    wait_for_ready "otel-collector-compat"
    wait_for_ready "otel-collector-custom"
    wait_for_ready "otel-collector-oidc"
    # otel-collector-oidc-missing-audience is expected to exit immediately,
    # not become ready -- checked directly in oidc-auth.bats instead.
}

teardown_suite() {
    attempt_env_cleanup
}