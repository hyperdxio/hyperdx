#!/bin/bash

export HYPERDX_LOG_LEVEL="error"
# https://clickhouse.com/docs/en/operations/server-configuration-parameters/settings#logger
export CLICKHOUSE_LOG_LEVEL="error"

# User-facing Services
export INGESTOR_API_URL="http://localhost:8002"
# User can specify either an entire SERVER_URL, or override slectively the 
# HYPERDX_API_URL or HYPERDX_API_PORT from the defaults
# Same applies to the frontend/app
export SERVER_URL="${SERVER_URL:-${HYPERDX_API_URL:-http://localhost}:${HYPERDX_API_PORT:-8000}}"
export FRONTEND_URL="${FRONTEND_URL:-${HYPERDX_APP_URL:-http://localhost}:${HYPERDX_APP_PORT:-8080}}"

# Internal Services
export AGGREGATOR_API_URL="http://aggregator:8001"
export CLICKHOUSE_HOST="http://ch-server:8123"
export MONGO_URI="mongodb://db:27017/hyperdx"
export REDIS_URI="redis://redis:6379"

export EXPRESS_SESSION_SECRET="hyperdx is cool 👋"
export IS_LOCAL_APP_MODE="DANGEROUSLY_is_local_app_mode💀"
export NEXT_TELEMETRY_DISABLED="1"

# Simulate Docker Service DNS
echo "127.0.0.1      aggregator" >> /etc/hosts
echo "127.0.0.1      ch-server" >> /etc/hosts
echo "127.0.0.1      db" >> /etc/hosts
echo "127.0.0.1      ingestor" >> /etc/hosts
echo "127.0.0.1      redis" >> /etc/hosts

echo "Visit the HyperDX UI at $FRONTEND_URL/search"
echo ""
echo "Send OpenTelemetry data via"
echo "http/protobuf: OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318"
echo "gRPC: OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4317"
echo ""
echo ""

# Start Clickhouse Server
/entrypoint.sh &

# Start Redis Server
redis-server > /var/log/redis.log 2>&1 &

# Start Mongo Server
mongod --quiet --dbpath /data/db > /var/log/mongod.log 2>&1 &

# Start Vector Ingestor
ENABLE_GO_PARSER="false" \
GO_PARSER_API_URL="http://go-parser:7777" \
IS_LOCAL_APP_MODE="true" \
vector \
  -qq \
  -c /etc/vector/sources.toml \
  -c /etc/vector/core.toml \
  -c /etc/vector/http-sinks.toml \
  --require-healthy true > /var/log/vector.log 2>&1 &

# Start Otel Collector
otelcol-contrib --config /etc/otelcol-contrib/config.yaml &

# Aggregator
APP_TYPE=aggregator \
CLICKHOUSE_USER=aggregator \
CLICKHOUSE_PASSWORD=aggregator \
PORT=8001 \
node /app/api/build/index.js > /var/log/aggregator.log 2>&1 &

# Api
APP_TYPE=api \
CLICKHOUSE_USER=api \
CLICKHOUSE_PASSWORD=api \
PORT=8000 \
node /app/api/build/index.js > /var/log/api.log 2>&1 &

# App
NODE_ENV=production \
PORT=8080 \
NEXT_PUBLIC_SERVER_URL="${SERVER_URL}" \
node /app/app/server.js > /var/log/app.log 2>&1 &

# Wait for any process to exit
wait -n

# Exit with status of process that exited first
exit $?
