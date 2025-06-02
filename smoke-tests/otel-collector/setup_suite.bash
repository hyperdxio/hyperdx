#!/usr/bin/env bats

load 'test_helpers/utilities.bash'
load 'test_helpers/assertions.bash'

setup_suite() {
    validate_env
    docker compose up --build --detach
    wait_for_ready "otel-collector"
}

teardown_suite() {
    attempt_env_cleanup
}