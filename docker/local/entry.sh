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
export AGGREGATOR_API_URL="http://localhost:8001"
export CLICKHOUSE_HOST="http://localhost:8123"
export MONGO_URI="mongodb://localhost:27017/hyperdx"
export REDIS_URI="redis://localhost:6379"

export EXPRESS_SESSION_SECRET="hyperdx is cool 👋"
export IS_LOCAL_APP_MODE="DANGEROUSLY_is_local_app_mode💀"
export NEXT_TELEMETRY_DISABLED="1"

# Simulate Docker Service DNS
echo "127.0.0.1      ingestor" >> /etc/hosts
echo "127.0.0.1      aggregator" >> /etc/hosts

echo "Visit the UI at $FRONTEND_URL"

# Start Clickhouse Server
/entrypoint.sh &

# Start Redis Server
redis-server &

# Start Mongo Server
mongod --quiet --dbpath /data/db &

# Start Vector Ingestor
ENABLE_GO_PARSER="false" \
GO_PARSER_API_URL="http://go-parser:7777" \
ENABLE_TOKEN_MATCHING_CHECK="false" \
vector \
  -qq \
  -c /etc/vector/sources.toml \
  -c /etc/vector/core.toml \
  -c /etc/vector/http-sinks.toml \
  --require-healthy true &

# Start Otel Collector
otelcol-contrib --config /etc/otelcol-contrib/config.yaml &

# Aggregator
APP_TYPE=aggregator \
CLICKHOUSE_USER=aggregator \
CLICKHOUSE_PASSWORD=aggregator \
PORT=8001 \
node /app/api/build/index.js &

# Api
APP_TYPE=api \
CLICKHOUSE_USER=api \
CLICKHOUSE_PASSWORD=api \
PORT=8000 \
node /app/api/build/index.js &

# App
NODE_ENV=production \
PORT=8080 \
NEXT_PUBLIC_SERVER_URL="${SERVER_URL}" \
node /app/app/server.js &

# Wait for any process to exit
wait -n

# Exit with status of process that exited first
exit $?
