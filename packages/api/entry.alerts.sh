#!/bin/bash
echo "Starting alerts task with provider: ${ALERT_PROVIDER:-default}"

exec node -r ./tracing ./tasks/index check-alerts --provider ${ALERT_PROVIDER:-default}
