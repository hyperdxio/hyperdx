#!/bin/bash

export HYPERDX_LOG_LEVEL="error"
# https://clickhouse.com/docs/en/operations/server-configuration-parameters/settings#logger
export CLICKHOUSE_LOG_LEVEL="error"

# User can specify either an entire SERVER_URL, or override slectively the 
# HYPERDX_API_URL or HYPERDX_API_PORT from the defaults
# Same applies to the frontend/app
export SERVER_URL="http://127.0.0.1:${HYPERDX_API_PORT:-8000}"
export FRONTEND_URL="${FRONTEND_URL:-${HYPERDX_APP_URL:-http://localhost}:${HYPERDX_APP_PORT:-8080}}"

# Internal Services
export CLICKHOUSE_ENDPOINT="tcp://ch-server:9000?dial_timeout=10s"
export MONGO_URI="mongodb://db:27017/hyperdx"

export EXPRESS_SESSION_SECRET="hyperdx is cool 👋"
# IS_LOCAL_APP_MODE should be set by the calling script
# Default to dangerous mode if not set
export IS_LOCAL_APP_MODE="${IS_LOCAL_APP_MODE}"
export NEXT_TELEMETRY_DISABLED="1"


# Simulate Docker Service DNS
echo "127.0.0.1      ch-server" >> /etc/hosts
echo "127.0.0.1      db" >> /etc/hosts

echo "Visit the HyperDX UI at $FRONTEND_URL/search"
echo ""
echo "Local App Mode: $IS_LOCAL_APP_MODE"
echo ""
echo "Send OpenTelemetry data via"
echo "http/protobuf: OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318"
echo "gRPC: OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4317"
echo ""
echo ""

# Start Clickhouse Server
/entrypoint.sh &

# Start Mongo Server
mongod --quiet --dbpath /data/db > /var/log/mongod.log 2>&1 &

# Wait for Clickhouse to be ready
while ! curl -s "http://ch-server:8123" > /dev/null; do
  echo "Waiting for Clickhouse to be ready..."
  sleep 1
done

# Start Otel Collector
otelcol-contrib --config /etc/otelcol-contrib/config.yaml &

# Start HyperDX app
npx concurrently \
  "--kill-others" \
  "--names=API,APP,ALERT-TASK" \
  "PORT=${HYPERDX_API_PORT:-8000} HYPERDX_APP_PORT=${HYPERDX_APP_PORT:-8080} node -r /app/api/node_modules/@hyperdx/node-opentelemetry/build/src/tracing /app/api/packages/api/build/index.js" \
  "HYPERDX_API_PORT=${HYPERDX_API_PORT:-8000} /app/app/node_modules/.bin/next start -p ${HYPERDX_APP_PORT:-8080}" \
  "node -r /app/api/node_modules/@hyperdx/node-opentelemetry/build/src/tracing /app/api/packages/api/build/tasks/index.js check-alerts" \
  > /var/log/app.log 2>&1 &

# Wait for any process to exit
wait -n

# Exit with status of process that exited first
exit $?
