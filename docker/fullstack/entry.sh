#!/bin/bash

# User can specify either an entire SERVER_URL, or override slectively the 
# Same applies to the frontend/app
export SERVER_URL="${SERVER_URL:-${HYPERDX_APP_URL:-http://localhost}:${HYPERDX_API_PORT:-8000}}"
export FRONTEND_URL="${FRONTEND_URL:-${HYPERDX_APP_URL:-http://localhost}:${HYPERDX_APP_PORT:-8080}}"

# Use concurrently to run both the API and App servers
npx concurrently \
  "--kill-others" \
  "--names=API,APP" \
  "FRONTEND_URL=\"${FRONTEND_URL}\" APP_TYPE=api PORT=${HYPERDX_API_PORT:-8000} node /app/api/build/index.js" \
  "NEXT_PUBLIC_SERVER_URL=\"${SERVER_URL}\" /app/app/node_modules/.bin/next start -p ${HYPERDX_APP_PORT:-8080}"

