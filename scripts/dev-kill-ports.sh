#!/usr/bin/env sh
# ---------------------------------------------------------------------------
# Kill orphaned dev processes on slot-specific ports
# Sourced after dev-env.sh so HYPERDX_API_PORT, HYPERDX_APP_PORT, etc. are set
# ---------------------------------------------------------------------------

PORTS="$HYPERDX_API_PORT $HYPERDX_APP_PORT $HYPERDX_OPAMP_PORT"

killed=0
for port in $PORTS; do
  [ -z "$port" ] && continue
  pids=$(lsof -ti :"$port" 2>/dev/null)
  for pid in $pids; do
    echo "Killing process $pid on port $port"
    kill "$pid" 2>/dev/null && killed=$((killed + 1))
  done
done

# Also kill the dev portal if running
if [ -n "$HDX_PORTAL_PORT" ]; then
  pids=$(lsof -ti :"$HDX_PORTAL_PORT" 2>/dev/null)
  for pid in $pids; do
    echo "Killing dev portal (pid $pid) on port $HDX_PORTAL_PORT"
    kill "$pid" 2>/dev/null && killed=$((killed + 1))
  done
fi

# Clean up slot file
if [ -n "$HDX_DEV_SLOTS_DIR" ] && [ -n "$HDX_DEV_SLOT" ]; then
  rm -f "${HDX_DEV_SLOTS_DIR}/${HDX_DEV_SLOT}.json" 2>/dev/null || true
  rm -rf "${HDX_DEV_SLOTS_DIR}/${HDX_DEV_SLOT}" 2>/dev/null || true
fi

if [ "$killed" -gt 0 ]; then
  echo "Killed $killed orphaned process(es)"
else
  echo "No orphaned dev processes found"
fi
