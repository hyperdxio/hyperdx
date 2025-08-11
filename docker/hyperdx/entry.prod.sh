#!/bin/bash

export FRONTEND_URL="${FRONTEND_URL:-${HYPERDX_APP_URL:-http://localhost}:${HYPERDX_APP_PORT:-8080}}"
export OPAMP_PORT=${HYPERDX_OPAMP_PORT:-4320}

# Set to "REQUIRED_AUTH" to enforce API authentication.
# ⚠️ Do not change this value !!!!
export IS_LOCAL_APP_MODE="REQUIRED_AUTH"

echo ""
echo "Starting HyperDX services..."
echo "Visit the HyperDX UI at $FRONTEND_URL"
echo ""

# Check if required files exist
if [ ! -f "./packages/api/dist/index.js" ]; then
    echo "ERROR: API build not found at ./packages/api/dist/index.js"
    exit 1
fi

if [ ! -d "./packages/app/.next" ]; then
    echo "ERROR: App build not found at ./packages/app/.next"
    exit 1
fi

# Use concurrently to run both the API and App servers
npx concurrently \
  "--kill-others-on-fail" \
  "--names=API,APP,ALERT-TASK" \
  "PORT=${HYPERDX_API_PORT:-8000} HYPERDX_APP_PORT=${HYPERDX_APP_PORT:-8080} node -r ./packages/api/dist/tracing.js ./packages/api/dist/index.js" \
  "cd ./packages/app && HOSTNAME='0.0.0.0' HYPERDX_API_PORT=${HYPERDX_API_PORT:-8000} PORT=${HYPERDX_APP_PORT:-8080} yarn start" \
  "node -r ./packages/api/dist/tracing.js ./packages/api/dist/tasks/index.js check-alerts"
