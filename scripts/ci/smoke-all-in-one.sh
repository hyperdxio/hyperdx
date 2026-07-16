#!/usr/bin/env bash
# Boots the all-in-one image, pushes one OTLP log through the collector, and
# asserts it lands in ClickHouse. Proves the artefact we ship actually works.
set -euo pipefail

IMAGE="${1:?usage: smoke-all-in-one.sh <image-ref>}"
NAME="hdx-smoke-$$"
APP_PORT="${SMOKE_APP_PORT:-18080}"
OTLP_PORT="${SMOKE_OTLP_PORT:-14318}"

cleanup() {
  docker logs "$NAME" --tail 200 > /tmp/hdx-smoke.log 2>&1 || true
  docker rm -f "$NAME" >/dev/null 2>&1 || true
}
trap cleanup EXIT

docker run -d --name "$NAME" -p "$APP_PORT:8080" -p "$OTLP_PORT:4318" "$IMAGE"

echo "waiting for app health..."
for i in $(seq 1 90); do
  curl -fsS "http://localhost:$APP_PORT/api/health" >/dev/null 2>&1 && break
  if [ "$i" = 90 ]; then
    echo "::error::app never became healthy"; docker logs "$NAME" --tail 100; exit 1
  fi
  sleep 2
done
echo "app healthy"

CANARY="smoke-canary-$(date +%s)-$$"
NOW_NS="$(date +%s)000000000"
curl -fsS -X POST "http://localhost:$OTLP_PORT/v1/logs" \
  -H 'Content-Type: application/json' \
  -d "{\"resourceLogs\":[{\"resource\":{\"attributes\":[{\"key\":\"service.name\",\"value\":{\"stringValue\":\"ci-smoke\"}}]},\"scopeLogs\":[{\"logRecords\":[{\"timeUnixNano\":\"$NOW_NS\",\"severityText\":\"INFO\",\"body\":{\"stringValue\":\"$CANARY\"}}]}]}]}"
echo "canary sent"

echo "waiting for canary in ClickHouse..."
for i in $(seq 1 45); do
  n="$(docker exec "$NAME" clickhouse-client --query \
    "SELECT count() FROM default.otel_logs WHERE Body LIKE '%$CANARY%'" 2>/dev/null || echo 0)"
  if [ "${n:-0}" -ge 1 ]; then
    echo "canary ingested end-to-end: collector -> clickhouse"
    exit 0
  fi
  sleep 2
done
echo "::error::canary never arrived in ClickHouse"
docker logs "$NAME" --tail 200
exit 1
