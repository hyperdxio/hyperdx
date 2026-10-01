#!/usr/bin/env bash
# Set up the full environment for hdx-eval, then exec the remaining args.
#
# 1. Set the dev stack's slot-based port vars from scripts/slots.sh
# 2. Wrap the command with dotenvx to load .env / .env.local
#
# Usage:
#   scripts/env.sh tsx src/cli.ts seed error-root-cause
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"

# Slot-based port env vars (HYPERDX_API_PORT, HDX_DEV_CH_HTTP_PORT, etc.)
# shellcheck source=../../../scripts/slots.sh
. "$REPO_ROOT/scripts/slots.sh"
hdx_dev_ports "$REPO_ROOT"

# Load .env.local from the monorepo root (existing vars take precedence)
exec "$REPO_ROOT/node_modules/.bin/dotenvx" run \
  -f "$REPO_ROOT/.env.local" \
  --ignore=MISSING_ENV_FILE --quiet -- "$@"
