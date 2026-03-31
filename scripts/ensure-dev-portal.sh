#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Ensure the HyperDX Dev Portal is running on port 9900 (or HDX_PORTAL_PORT).
#
# Works when sourced OR executed directly:
#   source scripts/ensure-dev-portal.sh   # sourced from another bash script
#   bash   scripts/ensure-dev-portal.sh   # executed from Makefile
#
# When sourced, HDX_PORTAL_PID is set in the caller's environment so the
# caller can kill the portal on exit if desired.
# ---------------------------------------------------------------------------

HDX_PORTAL_PORT="${HDX_PORTAL_PORT:-9900}"
HDX_PORTAL_PID=""

if ! (echo >/dev/tcp/127.0.0.1/"$HDX_PORTAL_PORT") 2>/dev/null; then
  # Resolve script directory — works for both source and direct execution
  _script_dir="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
  _portal_script="${_script_dir}/dev-portal/server.js"
  if [ -f "$_portal_script" ]; then
    HDX_PORTAL_PORT="$HDX_PORTAL_PORT" node "$_portal_script" >/dev/null 2>&1 &
    HDX_PORTAL_PID=$!
  fi
  unset _script_dir _portal_script
fi
