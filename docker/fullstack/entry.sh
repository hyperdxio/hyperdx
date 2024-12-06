#!/bin/bash

# Use concurrently to run both the API and App servers
npx concurrently \
  "--kill-others" \
  "--names=API,APP" \
  "APP_TYPE=api PORT=${HYPERDX_API_PORT:-8000} node /app/api/build/index.js" \
  "/app/app/node_modules/.bin/next start -p ${HYPERDX_APP_PORT:-8080}"
