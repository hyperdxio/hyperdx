#!/bin/bash

export HYPERDX_LOG_LEVEL="error"
# https://clickhouse.com/docs/en/operations/server-configuration-parameters/settings#logger
export CLICKHOUSE_LOG_LEVEL="error"

# User can specify either an entire SERVER_URL, or override slectively the 
# HYPERDX_API_URL or HYPERDX_API_PORT from the defaults
# Same applies to the frontend/app
export SERVER_URL="http://127.0.0.1:${HYPERDX_API_PORT:-8000}"
export FRONTEND_URL="${FRONTEND_URL:-${HYPERDX_APP_URL:-http://localhost}:${HYPERDX_APP_PORT:-8080}}"
export OPAMP_PORT=${HYPERDX_OPAMP_PORT:-4320}

# Internal Services
export HYPERDX_OTEL_EXPORTER_CLICKHOUSE_DATABASE="${HYPERDX_OTEL_EXPORTER_CLICKHOUSE_DATABASE:-default}"
export CLICKHOUSE_ENDPOINT="${CLICKHOUSE_ENDPOINT:-tcp://ch-server:9000?dial_timeout=10s}"
export MONGO_URI="mongodb://db:27017/hyperdx"
export OPAMP_SERVER_URL="http://127.0.0.1:${OPAMP_PORT}"
export CLICKHOUSE_PROMETHEUS_METRICS_ENDPOINT="${CLICKHOUSE_PROMETHEUS_METRICS_ENDPOINT:-ch-server:9363}"

export HYPERDX_IMAGE=$([[ "${IS_LOCAL_APP_MODE}" == "DANGEROUSLY_is_local_app_mode💀" ]] && echo "all-in-one" || echo "all-in-one-noauth")
export EXPRESS_SESSION_SECRET="hyperdx is cool 👋"
# IS_LOCAL_APP_MODE should be set by the calling script
# Default to dangerous mode if not set
export IS_LOCAL_APP_MODE="${IS_LOCAL_APP_MODE}"
export NEXT_TELEMETRY_DISABLED="1"

# Set Default Connections and Sources
if [ -z "${DEFAULT_CONNECTIONS}" ]; then
  DEFAULT_CONNECTIONS='[{"name":"Local ClickHouse","host":"http://localhost:8123","username":"default","password":""}]'
fi
export DEFAULT_CONNECTIONS
export DEFAULT_SOURCES='[{"from":{"databaseName":"default","tableName":"otel_logs"},"kind":"log","timestampValueExpression":"TimestampTime","name":"Logs","displayedTimestampValueExpression":"Timestamp","implicitColumnExpression":"Body","serviceNameExpression":"ServiceName","bodyExpression":"Body","eventAttributesExpression":"LogAttributes","resourceAttributesExpression":"ResourceAttributes","defaultTableSelectExpression":"Timestamp,ServiceName,SeverityText,Body","severityTextExpression":"SeverityText","traceIdExpression":"TraceId","spanIdExpression":"SpanId","connection":"Local ClickHouse","traceSourceId":"Traces","sessionSourceId":"Sessions","metricSourceId":"Metrics"},{"from":{"databaseName":"default","tableName":"otel_traces"},"kind":"trace","timestampValueExpression":"Timestamp","name":"Traces","displayedTimestampValueExpression":"Timestamp","implicitColumnExpression":"SpanName","serviceNameExpression":"ServiceName","eventAttributesExpression":"SpanAttributes","resourceAttributesExpression":"ResourceAttributes","defaultTableSelectExpression":"Timestamp,ServiceName,StatusCode,round(Duration/1e6),SpanName","traceIdExpression":"TraceId","spanIdExpression":"SpanId","durationExpression":"Duration","durationPrecision":9,"parentSpanIdExpression":"ParentSpanId","spanNameExpression":"SpanName","spanKindExpression":"SpanKind","statusCodeExpression":"StatusCode","statusMessageExpression":"StatusMessage","connection":"Local ClickHouse","logSourceId":"Logs","sessionSourceId":"Sessions","metricSourceId":"Metrics"},{"from":{"databaseName":"default","tableName":""},"kind":"metric","timestampValueExpression":"TimeUnix","name":"Metrics","resourceAttributesExpression":"ResourceAttributes","metricTables":{"gauge":"otel_metrics_gauge","histogram":"otel_metrics_histogram","sum":"otel_metrics_sum","summary":"otel_metrics_summary","exponentialHistogram":"otel_metrics_exponential_histogram","_id":"682586a8b1f81924e628e808","id":"682586a8b1f81924e628e808"},"connection":"Local ClickHouse","logSourceId":"Logs","traceSourceId":"Traces","sessionSourceId":"Sessions"},{"from":{"databaseName":"default","tableName":"hyperdx_sessions"},"kind":"session","timestampValueExpression":"TimestampTime","name":"Sessions","displayedTimestampValueExpression":"Timestamp","implicitColumnExpression":"Body","serviceNameExpression":"ServiceName","bodyExpression":"Body","eventAttributesExpression":"LogAttributes","resourceAttributesExpression":"ResourceAttributes","defaultTableSelectExpression":"Timestamp,ServiceName,SeverityText,Body","severityTextExpression":"SeverityText","traceIdExpression":"TraceId","spanIdExpression":"SpanId","connection":"Local ClickHouse","logSourceId":"Logs","traceSourceId":"Traces","metricSourceId":"Metrics"}]'
# if BETA_CH_OTEL_JSON_SCHEMA_ENABLED is true then return empty default sources
if [ "$BETA_CH_OTEL_JSON_SCHEMA_ENABLED" = "true" ]; then
  export DEFAULT_SOURCES='[{"from":{"databaseName":"default","tableName":"otel_logs"},"kind":"log","timestampValueExpression":"Timestamp","name":"Logs","displayedTimestampValueExpression":"Timestamp","implicitColumnExpression":"Body","serviceNameExpression":"ServiceName","bodyExpression":"Body","eventAttributesExpression":"LogAttributes","resourceAttributesExpression":"ResourceAttributes","defaultTableSelectExpression":"Timestamp,ServiceName,SeverityText,Body","severityTextExpression":"SeverityText","traceIdExpression":"TraceId","spanIdExpression":"SpanId","connection":"Local ClickHouse","traceSourceId":"Traces","sessionSourceId":"Sessions","metricSourceId":"Metrics"},{"from":{"databaseName":"default","tableName":"otel_traces"},"kind":"trace","timestampValueExpression":"Timestamp","name":"Traces","displayedTimestampValueExpression":"Timestamp","implicitColumnExpression":"SpanName","serviceNameExpression":"ServiceName","eventAttributesExpression":"SpanAttributes","resourceAttributesExpression":"ResourceAttributes","defaultTableSelectExpression":"Timestamp,ServiceName,StatusCode,round(Duration/1e6),SpanName","traceIdExpression":"TraceId","spanIdExpression":"SpanId","durationExpression":"Duration","durationPrecision":9,"parentSpanIdExpression":"ParentSpanId","spanNameExpression":"SpanName","spanKindExpression":"SpanKind","statusCodeExpression":"StatusCode","statusMessageExpression":"StatusMessage","connection":"Local ClickHouse","logSourceId":"Logs","sessionSourceId":"Sessions","metricSourceId":"Metrics"},{"from":{"databaseName":"default","tableName":""},"kind":"metric","timestampValueExpression":"TimeUnix","name":"Metrics","resourceAttributesExpression":"ResourceAttributes","metricTables":{"gauge":"otel_metrics_gauge","histogram":"otel_metrics_histogram","sum":"otel_metrics_sum","summary":"otel_metrics_summary","exponentialHistogram":"otel_metrics_exponential_histogram","_id":"682586a8b1f81924e628e808","id":"682586a8b1f81924e628e808"},"connection":"Local ClickHouse","logSourceId":"Logs","traceSourceId":"Traces","sessionSourceId":"Sessions"},{"from":{"databaseName":"default","tableName":"hyperdx_sessions"},"kind":"session","timestampValueExpression":"Timestamp","name":"Sessions","displayedTimestampValueExpression":"Timestamp","implicitColumnExpression":"Body","serviceNameExpression":"ServiceName","bodyExpression":"Body","eventAttributesExpression":"LogAttributes","resourceAttributesExpression":"ResourceAttributes","defaultTableSelectExpression":"Timestamp,ServiceName,SeverityText,Body","severityTextExpression":"SeverityText","traceIdExpression":"TraceId","spanIdExpression":"SpanId","connection":"Local ClickHouse","logSourceId":"Logs","traceSourceId":"Traces","metricSourceId":"Metrics"}]'
fi

# Simulate Docker Service DNS
echo "127.0.0.1      ch-server" >> /etc/hosts
echo "127.0.0.1      db" >> /etc/hosts

echo ""
echo "Send OpenTelemetry data via:
  http/protobuf: OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318
  gRPC: OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4317
"
echo "Exporting data to ClickHouse:
  Endpoint: $CLICKHOUSE_ENDPOINT
  Database: $HYPERDX_OTEL_EXPORTER_CLICKHOUSE_DATABASE
"

# Start Clickhouse Server
/entrypoint.sh > /var/log/clickhouse.log 2>&1 &

# Start Mongo Server
mongod --quiet --dbpath /data/db > /var/log/mongod.log 2>&1 &

# Wait for Clickhouse to be ready
while ! curl -s "http://ch-server:8123" > /dev/null; do
  echo "Waiting for ClickHouse to be ready..."
  sleep 1
done
echo "ClickHouse is ready!"

# Start Otel Collector with entrypoint script for template rendering and log rotation
/otel-entrypoint.sh /usr/local/bin/opampsupervisor > /var/log/otel-collector.log 2>&1 &

# Start HyperDX app
./node_modules/.bin/concurrently \
  "--kill-others-on-fail" \
  "--names=API,APP,ALERT-TASK" \
  "PORT=${HYPERDX_API_PORT:-8000} HYPERDX_APP_PORT=${HYPERDX_APP_PORT:-8080} node -r ./node_modules/@hyperdx/node-opentelemetry/build/src/tracing ./packages/api/build/index.js" \
  "cd ./packages/app/packages/app && HOSTNAME='${HYPERDX_APP_LISTEN_HOSTNAME:-0.0.0.0}' HYPERDX_API_PORT=${HYPERDX_API_PORT:-8000} PORT=${HYPERDX_APP_PORT:-8080} node server.js" \
  "node -r ./node_modules/@hyperdx/node-opentelemetry/build/src/tracing ./packages/api/build/tasks/index.js check-alerts" \
  > /var/log/app.log 2>&1 &

echo ""
echo "Visit the HyperDX UI at $FRONTEND_URL"
echo ""

# Wait for any process to exit
wait -n

# Exit with status of process that exited first
exit $?
