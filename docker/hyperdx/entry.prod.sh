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

# Optionally include the dashboard provisioner task
EXTRA_NAMES=""
EXTRA_CMDS=""
if [ -n "$DASHBOARD_PROVISIONER_DIR" ]; then
  EXTRA_NAMES=",DASH-PROVISION"
  EXTRA_CMDS="./packages/api/bin/hyperdx task provision-dashboards"
fi

# Use concurrently to run all services
./node_modules/.bin/concurrently \
  "--kill-others-on-fail" \
  "--names=API,APP,ALERT-TASK${EXTRA_NAMES}" \
  "PORT=${HYPERDX_API_PORT:-8000} HYPERDX_APP_PORT=${HYPERDX_APP_PORT:-8080} ./packages/api/bin/hyperdx api" \
  "cd ./packages/app/packages/app && HOSTNAME='${HYPERDX_APP_LISTEN_HOSTNAME:-0.0.0.0}' HYPERDX_API_PORT=${HYPERDX_API_PORT:-8000} PORT=${HYPERDX_APP_PORT:-8080} node server.js" \
  "./packages/api/bin/hyperdx task check-alerts" \
  ${EXTRA_CMDS:+"$EXTRA_CMDS"}
