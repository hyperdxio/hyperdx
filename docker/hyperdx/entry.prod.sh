#!/bin/bash

export FRONTEND_URL="${FRONTEND_URL:-${HYPERDX_APP_URL:-http://localhost}:${HYPERDX_APP_PORT:-8080}}"
export OPAMP_PORT=${HYPERDX_OPAMP_PORT:-4320}
export HYPERDX_IMAGE="hyperdx"

# Set to "REQUIRED_AUTH" to enforce API authentication.
# ⚠️ Do not change this value !!!!
export IS_LOCAL_APP_MODE="REQUIRED_AUTH"

echo ""
echo "Visit the HyperDX UI at $FRONTEND_URL"
echo ""

# Use concurrently to run both the API and App servers
npx concurrently \
  "--kill-others-on-fail" \
  "--names=API,APP,ALERT-TASK" \
  "PORT=${HYPERDX_API_PORT:-8000} HYPERDX_APP_PORT=${HYPERDX_APP_PORT:-8080} node -r ./packages/api/tracing ./packages/api/index" \
  "cd ./packages/app/packages/app && HOSTNAME='0.0.0.0' HYPERDX_API_PORT=${HYPERDX_API_PORT:-8000} PORT=${HYPERDX_APP_PORT:-8080} node server.js" \
  "node -r ./packages/api/tracing ./packages/api/tasks/index check-alerts"
