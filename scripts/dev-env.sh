#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Dev stack setup for `yarn dev`
# ---------------------------------------------------------------------------
# Sets this worktree's slot and ports (see scripts/slots.sh for the scheme),
# then prepares its dev stack: clears stale Next.js output, registers the slot
# with the dev portal, and archives its logs on exit.
#
# Only source this when starting or stopping the stack. Tools that just need
# the ports should use scripts/with-slots.sh, which has no side effects.
#
# Usage:
#   source scripts/dev-env.sh        # export env vars into current shell
#   . scripts/dev-env.sh             # same thing, POSIX style
#
# Override the slot manually:
#   HDX_DEV_SLOT=5 . scripts/dev-env.sh
# ---------------------------------------------------------------------------

# shellcheck source=./slots.sh
. "${BASH_SOURCE[0]%/*}/slots.sh"
hdx_dev_ports

# Git metadata for portal labels
HDX_DEV_BRANCH="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo 'unknown')"
HDX_DEV_WORKTREE="$(basename "$PWD")"

# --- Shared NX build cache across all worktrees ---
# NX cache is content-hash based so changed files get cache misses (correct
# behavior). Unchanged packages reuse cached output regardless of worktree.
NX_CACHE_DIRECTORY="${HOME}/.config/hyperdx/nx-cache"
mkdir -p "$NX_CACHE_DIRECTORY"

export HDX_DEV_BRANCH
export HDX_DEV_WORKTREE
export NX_CACHE_DIRECTORY

# --- Clean up stale Next.js state from previous sessions ---
# Nuke the entire .next directory to avoid stale webpack bundles, lock files,
# and cached module resolutions after common-utils rebuilds.
rm -rf "${PWD}/packages/app/.next" 2>/dev/null || true

# --- Set up directories for portal discovery + logs ---
HDX_DEV_SLOTS_DIR="${HOME}/.config/hyperdx/dev-slots"
HDX_DEV_LOGS_DIR="${HDX_DEV_SLOTS_DIR}/${HDX_DEV_SLOT}/logs"
mkdir -p "$HDX_DEV_LOGS_DIR"

export HDX_DEV_SLOTS_DIR
export HDX_DEV_LOGS_DIR

cat > "${HDX_DEV_SLOTS_DIR}/${HDX_DEV_SLOT}.json" <<EOF
{
  "slot": ${HDX_DEV_SLOT},
  "branch": "${HDX_DEV_BRANCH}",
  "worktree": "${HDX_DEV_WORKTREE}",
  "worktreePath": "${PWD}",
  "apiPort": ${HYPERDX_API_PORT},
  "appPort": ${HYPERDX_APP_PORT},
  "opampPort": ${HYPERDX_OPAMP_PORT},
  "mongoPort": ${HDX_DEV_MONGO_PORT},
  "chHttpPort": ${HDX_DEV_CH_HTTP_PORT},
  "chNativePort": ${HDX_DEV_CH_NATIVE_PORT},
  "otelHttpPort": ${HDX_DEV_OTEL_HTTP_PORT},
  "otelGrpcPort": ${HDX_DEV_OTEL_GRPC_PORT},
  "otelJsonHttpPort": ${HDX_DEV_OTEL_JSON_HTTP_PORT},
  "logsDir": "${HDX_DEV_LOGS_DIR}",
  "pid": $$,
  "startedAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
EOF

# --- Start dev portal in background if port 9900 is free ---
# shellcheck source=./ensure-dev-portal.sh
source "${BASH_SOURCE[0]%/*}/ensure-dev-portal.sh"

# Clean up slot file and archive logs on exit
_hdx_cleanup_slot() {
  if [ -n "$HDX_PORTAL_PID" ] && kill -0 "$HDX_PORTAL_PID" 2>/dev/null; then
    kill "$HDX_PORTAL_PID" 2>/dev/null || true
  fi
  rm -f "${HDX_DEV_SLOTS_DIR}/${HDX_DEV_SLOT}.json" 2>/dev/null || true
  # Archive logs to history instead of deleting
  if [ -d "$HDX_DEV_LOGS_DIR" ] && [ -n "$(ls -A "$HDX_DEV_LOGS_DIR" 2>/dev/null)" ]; then
    _ts=$(date -u +%Y-%m-%dT%H:%M:%SZ)
    _hist="${HDX_DEV_SLOTS_DIR}/${HDX_DEV_SLOT}/history/dev-${_ts}"
    mkdir -p "$_hist"
    mv "$HDX_DEV_LOGS_DIR"/* "$_hist/" 2>/dev/null || true
    cat > "$_hist/meta.json" <<METAEOF
{"worktree":"${HDX_DEV_WORKTREE}","branch":"${HDX_DEV_BRANCH}","worktreePath":"${PWD}"}
METAEOF
  fi
  rm -rf "$HDX_DEV_LOGS_DIR" 2>/dev/null || true
}
trap _hdx_cleanup_slot EXIT

# Print summary
echo "╔══════════════════════════════════════════════════════════════╗"
echo "║  HyperDX Dev Environment — Slot ${HDX_DEV_SLOT}$(printf '%*s' $((27 - ${#HDX_DEV_SLOT})) '')║"
echo "╠══════════════════════════════════════════════════════════════╣"
echo "║  Branch:     ${HDX_DEV_BRANCH}$(printf '%*s' $((45 - ${#HDX_DEV_BRANCH})) '')║"
echo "║  Worktree:   ${HDX_DEV_WORKTREE}$(printf '%*s' $((45 - ${#HDX_DEV_WORKTREE})) '')║"
echo "╠══════════════════════════════════════════════════════════════╣"
echo "║  App (Next.js)     http://localhost:${HYPERDX_APP_PORT}$(printf '%*s' $((22 - ${#HYPERDX_APP_PORT})) '')║"
echo "║  API               http://localhost:${HYPERDX_API_PORT}$(printf '%*s' $((22 - ${#HYPERDX_API_PORT})) '')║"
echo "║  ClickHouse        http://localhost:${HDX_DEV_CH_HTTP_PORT}$(printf '%*s' $((22 - ${#HDX_DEV_CH_HTTP_PORT})) '')║"
echo "║  MongoDB           localhost:${HDX_DEV_MONGO_PORT}$(printf '%*s' $((29 - ${#HDX_DEV_MONGO_PORT})) '')║"
echo "║  OTel HTTP         http://localhost:${HDX_DEV_OTEL_HTTP_PORT}$(printf '%*s' $((22 - ${#HDX_DEV_OTEL_HTTP_PORT})) '')║"
echo "║  OTel gRPC         localhost:${HDX_DEV_OTEL_GRPC_PORT}$(printf '%*s' $((29 - ${#HDX_DEV_OTEL_GRPC_PORT})) '')║"
echo "║  OpAMP             localhost:${HYPERDX_OPAMP_PORT}$(printf '%*s' $((29 - ${#HYPERDX_OPAMP_PORT})) '')║"
echo "╠══════════════════════════════════════════════════════════════╣"
echo "║  Portal:  http://localhost:${HDX_PORTAL_PORT}$(printf '%*s' $((28 - ${#HDX_PORTAL_PORT})) '')║"
echo "╚══════════════════════════════════════════════════════════════╝"
