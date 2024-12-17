#!/bin/bash

export FRONTEND_URL="${FRONTEND_URL:-${HYPERDX_APP_URL:-http://localhost}:${HYPERDX_APP_PORT:-8080}}"

echo "Visit the HyperDX UI at $FRONTEND_URL"
echo ""

# Use concurrently to run both the API and App servers
npx concurrently \
  "--kill-others" \
  "--names=API,APP" \
  "PORT=${HYPERDX_API_PORT:-8000} HYPERDX_APP_PORT=${HYPERDX_APP_PORT:-8080} node -r /app/api/node_modules/@hyperdx/node-opentelemetry/build/src/tracing /app/api/build/index.js" \
  "HYPERDX_API_PORT=${HYPERDX_API_PORT:-8000} /app/app/node_modules/.bin/next start -p ${HYPERDX_APP_PORT:-8080}"
