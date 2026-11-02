#!/usr/bin/env bats

# The entrypoint must disable Go's default Multipath TCP listeners
# (CVE-2026-98432). In standalone mode the collector is exec'd as PID 1.

@test "GODEBUG: the collector process runs with multipathtcp=0" {
    run docker compose exec -T otel-collector sh -c 'tr "\0" "\n" < /proc/1/environ'
    [ "$status" -eq 0 ]
    echo "$output" | grep -qx 'GODEBUG=multipathtcp=0'
}
