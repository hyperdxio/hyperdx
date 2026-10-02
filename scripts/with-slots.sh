#!/bin/sh
# Runs a command with this worktree's dev stack ports set (HDX_DEV_SLOT,
# HDX_DEV_CH_HTTP_PORT, HYPERDX_API_PORT, ...; see slots.sh), for tools that
# talk to a running `yarn dev` stack. Works from any directory.
#
#   scripts/with-slots.sh ts-node scripts/seed-alerts.ts
#   HDX_DEV_SLOT=5 scripts/with-slots.sh ...   # target another slot
set -e
_hdx_scripts="$(dirname "$0")"
. "$_hdx_scripts/slots.sh"
hdx_dev_ports "$_hdx_scripts"
exec "$@"
