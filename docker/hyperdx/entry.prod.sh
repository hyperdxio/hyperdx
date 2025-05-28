#!/bin/bash

export FRONTEND_URL="${FRONTEND_URL:-${HYPERDX_APP_URL:-http://localhost}:${HYPERDX_APP_PORT:-8080}}"
export OPAMP_PORT=${HYPERDX_OPAMP_PORT:-4320}

# Set to "REQUIRED_AUTH" to enforce API authentication.
# ⚠️ Do not change this value !!!!
export IS_LOCAL_APP_MODE="REQUIRED_AUTH"

echo ""
echo "Visit the HyperDX UI at $FRONTEND_URL"
echo ""

# Use concurrently to run both the API and App servers
npx concurrently \
  "--kill-others" \
  "--names=API,APP,ALERT-TASK" \
  "PORT=${HYPERDX_API_PORT:-8000} HYPERDX_APP_PORT=${HYPERDX_APP_PORT:-8080} node -r /app/api/node_modules/@hyperdx/node-opentelemetry/build/src/tracing /app/api/packages/api/build/index.js" \
  "HYPERDX_API_PORT=${HYPERDX_API_PORT:-8000} /app/app/node_modules/.bin/next start -p ${HYPERDX_APP_PORT:-8080}" \
  "node -r /app/api/node_modules/@hyperdx/node-opentelemetry/build/src/tracing /app/api/packages/api/build/tasks/index.js check-alerts"
