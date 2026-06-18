#!/usr/bin/env bash
# Set up the full environment for hdx-eval, then exec the remaining args.
#
# 1. Source dev-env.sh from the monorepo root for slot-based port vars
# 2. Wrap the command with dotenvx to load .env / .env.local
#
# Usage:
#   scripts/env.sh tsx src/cli.ts seed error-root-cause
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"

# Slot-based port env vars (HYPERDX_API_PORT, HDX_DEV_CH_HTTP_PORT, etc.)
_HDX_EVAL_CWD="$PWD"
cd "$REPO_ROOT" && source ./scripts/dev-env.sh > /dev/null 2>&1
cd "$_HDX_EVAL_CWD"
unset _HDX_EVAL_CWD

# Load .env.local from the monorepo root (existing vars take precedence)
exec "$REPO_ROOT/node_modules/.bin/dotenvx" run \
  -f "$REPO_ROOT/.env.local" \
  --ignore=MISSING_ENV_FILE --quiet -- "$@"
