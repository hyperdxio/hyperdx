#!/bin/bash

export FRONTEND_URL="${FRONTEND_URL:-${HYPERDX_APP_URL:-http://localhost}:${HYPERDX_APP_PORT:-8080}}"

# Internal Services
export MONGO_URI="${MONGO_URI:-mongodb://127.0.0.1:27017/hyperdx}"

echo "Visit the HyperDX UI at $FRONTEND_URL"
echo ""

# Start Mongo Server if it exists (will run in prod-extended but not in prod)
if command -v mongod &> /dev/null; then
  echo "Starting MongoDB server..."
  mongod --quiet --dbpath /data/db > /var/log/mongod.log 2>&1 &
  # Wait for MongoDB to start
  sleep 2
fi

# Use concurrently to run both the API and App servers
npx concurrently \
  "--kill-others" \
  "--names=API,APP" \
  "MONGO_URI=${MONGO_URI} PORT=${HYPERDX_API_PORT:-8000} HYPERDX_APP_PORT=${HYPERDX_APP_PORT:-8080} node -r /app/api/node_modules/@hyperdx/node-opentelemetry/build/src/tracing /app/api/build/index.js" \
  "HYPERDX_API_PORT=${HYPERDX_API_PORT:-8000} /app/app/node_modules/.bin/next start -p ${HYPERDX_APP_PORT:-8080}"
