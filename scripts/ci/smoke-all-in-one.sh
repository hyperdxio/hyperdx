#!/usr/bin/env bash
# Boots an all-in-one image and proves it actually runs.
#
# Default (full) mode — for the noauth/Local image, which accepts OTLP without
# an API key: boot, wait for /api/health, push one OTLP log through the bundled
# collector, and assert it lands in ClickHouse. End-to-end ingest of the
# artefact we ship.
#
# --health-only mode — for the auth all-in-one image, which gates ingestion
# behind an INGESTION_API_KEY bootstrap so the collector never opens a keyless
# OTLP receiver (see docker/hyperdx/entry.local.base.sh). A keyless OTLP canary
# cannot work there, so instead: boot, wait for /api/health, and assert
# ClickHouse is up inside the container. The OTLP port is not mapped in this mode.
set -euo pipefail

IMAGE="${1:?usage: smoke-all-in-one.sh <image-ref> [--health-only]}"
MODE="${2:-full}"

case "$MODE" in
  --health-only) HEALTH_ONLY=1 ;;
  full) HEALTH_ONLY=0 ;;
  *)
    echo "::error::unknown mode '$MODE' (expected --health-only or nothing)"
    exit 2
    ;;
esac

NAME="hdx-smoke-$$"
APP_PORT="${SMOKE_APP_PORT:-18080}"
OTLP_PORT="${SMOKE_OTLP_PORT:-14318}"

cleanup() {
  docker rm -f "$NAME" >/dev/null 2>&1 || true
}
trap cleanup EXIT

# Pull with a small retry so a transient registry hiccup can't flake the release
# gate (docker run would otherwise pull implicitly, with no retry). Skip the pull
# when the image is already in the local daemon — the PR build loads its image
# with `load: true` and never pushes it, so a `docker pull` would hit the
# registry and fail for a tag that only exists locally.
if docker image inspect "$IMAGE" >/dev/null 2>&1; then
  echo "using locally-loaded image $IMAGE (skipping pull)"
else
  for attempt in 1 2 3; do
    docker pull "$IMAGE" && break
    if [ "$attempt" = 3 ]; then
      echo "::error::failed to pull $IMAGE after 3 attempts"; exit 1
    fi
    echo "pull failed (attempt $attempt/3), retrying in 5s..."; sleep 5
  done
fi

if [ "$HEALTH_ONLY" = 1 ]; then
  docker run -d --name "$NAME" -p "$APP_PORT:8080" "$IMAGE"
else
  docker run -d --name "$NAME" -p "$APP_PORT:8080" -p "$OTLP_PORT:4318" "$IMAGE"
fi

echo "waiting for app health..."
for i in $(seq 1 90); do
  # Fail fast if the container exited (bad entrypoint, port clash, missing env)
  # instead of polling a dead container for the full timeout.
  if [ "$(docker inspect -f '{{.State.Running}}' "$NAME" 2>/dev/null)" != "true" ]; then
    echo "::error::container exited during startup"; docker logs "$NAME" --tail 200; exit 1
  fi
  curl -fsS "http://localhost:$APP_PORT/api/health" >/dev/null 2>&1 && break
  if [ "$i" = 90 ]; then
    echo "::error::app never became healthy"; docker logs "$NAME" --tail 100; exit 1
  fi
  sleep 2
done
echo "app healthy"

if [ "$HEALTH_ONLY" = 1 ]; then
  echo "waiting for ClickHouse..."
  for i in $(seq 1 45); do
    ok="$(docker exec "$NAME" clickhouse-client --query "SELECT 1" 2>/dev/null || echo 0)"
    if [ "${ok:-0}" = 1 ]; then
      echo "health-only smoke passed: app healthy + clickhouse up"
      exit 0
    fi
    if [ "$i" = 45 ]; then
      echo "::error::clickhouse never came up"; docker logs "$NAME" --tail 200; exit 1
    fi
    sleep 2
  done
fi

CANARY="smoke-canary-$(date +%s)-$$"
NOW_NS="$(date +%s)000000000"
PAYLOAD="{\"resourceLogs\":[{\"resource\":{\"attributes\":[{\"key\":\"service.name\",\"value\":{\"stringValue\":\"ci-smoke\"}}]},\"scopeLogs\":[{\"logRecords\":[{\"timeUnixNano\":\"$NOW_NS\",\"severityText\":\"INFO\",\"body\":{\"stringValue\":\"$CANARY\"}}]}]}]}"

# The Node app reports /api/health before the separately-supervised collector's
# :4318 receiver is necessarily listening, so retry the POST until it's accepted
# rather than aborting on a transient connection-refused (which would false-fail
# the release gate).
echo "sending canary (collector may still be starting)..."
for i in $(seq 1 45); do
  if curl -fsS -X POST "http://localhost:$OTLP_PORT/v1/logs" \
       -H 'Content-Type: application/json' -d "$PAYLOAD" >/dev/null 2>&1; then
    echo "canary sent"
    break
  fi
  if [ "$i" = 45 ]; then
    echo "::error::collector never accepted the OTLP canary on :$OTLP_PORT"
    docker logs "$NAME" --tail 200; exit 1
  fi
  sleep 2
done

echo "waiting for canary in ClickHouse..."
for i in $(seq 1 45); do
  n="$(docker exec "$NAME" clickhouse-client --query \
    "SELECT count() FROM default.otel_logs WHERE Body LIKE '%$CANARY%'" 2>/dev/null || echo 0)"
  n="${n//[!0-9]/}"
  if [ "${n:-0}" -ge 1 ]; then
    echo "canary ingested end-to-end: collector -> clickhouse"
    exit 0
  fi
  sleep 2
done
echo "::error::canary never arrived in ClickHouse"
docker logs "$NAME" --tail 200
exit 1
