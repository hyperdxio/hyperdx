#!/usr/bin/env bats

# pprof must answer on 127.0.0.1:1777 inside the collector container. The auth
# overlays restate service.extensions in full, so each one is checked.

load 'test_helpers/utilities.bash'

assert_pprof() {
    run docker compose exec -T "$1" wget -qO- 127.0.0.1:1777/debug/pprof/
    [ "$status" -eq 0 ]
    [[ "$output" == *"/debug/pprof/"* ]]
}

@test "pprof: served by the standalone collector" {
    assert_pprof otel-collector
}

@test "pprof: served with static bearer-token auth" {
    assert_pprof otel-collector-bearer-auth
}

@test "pprof: served with OIDC auth" {
    assert_pprof otel-collector-oidc
}
