#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Dev environment isolation helper
# ---------------------------------------------------------------------------
# Computes a deterministic port offset (HDX_DEV_SLOT, 0-99) from the current
# working directory name so that multiple git worktrees can run the full dev
# stack in parallel without port conflicts.
#
# Usage:
#   source scripts/dev-env.sh        # export env vars into current shell
#   . scripts/dev-env.sh             # same thing, POSIX style
#
# Override the slot manually:
#   HDX_DEV_SLOT=5 . scripts/dev-env.sh
#
# Port allocation scheme — each service gets a 100-wide band in the 30100-30499
# range, well clear of:
#   - CI integration test ports (19000-19099, 39999-40098)
#   - E2E test ports           (20320-21399)
#   - Default dev ports        (8000, 8080, 27017)
#   - OS ephemeral ports       (32768+ Linux, 49152+ macOS)
#
# Port mapping (base + slot):
#   API server        : 30100 + slot   (BERG_API_PORT)
#   App (Next.js)     : 30200 + slot   (BERG_APP_PORT)
#   MongoDB           : 30400 + slot   (HDX_DEV_MONGO_PORT)
# ---------------------------------------------------------------------------

# Compute slot from directory name (same algorithm as CI slot in Makefile)
HDX_DEV_SLOT="${HDX_DEV_SLOT:-$(printf '%s' "$(basename "$PWD")" | cksum | awk '{print $1 % 100}')}"

# Git metadata for portal labels
HDX_DEV_BRANCH="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo 'unknown')"
HDX_DEV_WORKTREE="$(basename "$PWD")"

# --- Application ports (30100-30299) ---
BERG_API_PORT=$((30100 + HDX_DEV_SLOT))
BERG_APP_PORT=$((30200 + HDX_DEV_SLOT))

# --- Docker service ports (30400-30499) ---
HDX_DEV_MONGO_PORT=$((30400 + HDX_DEV_SLOT))

# --- Docker Compose project name (unique per slot) ---
HDX_DEV_PROJECT="hdx-dev-${HDX_DEV_SLOT}"

# --- Shared NX build cache across all worktrees ---
# NX cache is content-hash based so changed files get cache misses (correct
# behavior). Unchanged packages reuse cached output regardless of worktree.
NX_CACHE_DIRECTORY="${HOME}/.config/hyperdx/nx-cache"
mkdir -p "$NX_CACHE_DIRECTORY"

# Export everything
export HDX_DEV_SLOT
export HDX_DEV_BRANCH
export HDX_DEV_WORKTREE
export BERG_API_PORT
export BERG_APP_PORT
export HDX_DEV_MONGO_PORT
export HDX_DEV_PROJECT
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
  "apiPort": ${BERG_API_PORT},
  "appPort": ${BERG_APP_PORT},
  "mongoPort": ${HDX_DEV_MONGO_PORT},
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
echo "║  Berg Dev Environment — Slot ${HDX_DEV_SLOT}$(printf '%*s' $((30 - ${#HDX_DEV_SLOT})) '')║"
echo "╠══════════════════════════════════════════════════════════════╣"
echo "║  Branch:     ${HDX_DEV_BRANCH}$(printf '%*s' $((45 - ${#HDX_DEV_BRANCH})) '')║"
echo "║  Worktree:   ${HDX_DEV_WORKTREE}$(printf '%*s' $((45 - ${#HDX_DEV_WORKTREE})) '')║"
echo "╠══════════════════════════════════════════════════════════════╣"
echo "║  App (Next.js)     http://localhost:${BERG_APP_PORT}$(printf '%*s' $((22 - ${#BERG_APP_PORT})) '')║"
echo "║  API               http://localhost:${BERG_API_PORT}$(printf '%*s' $((22 - ${#BERG_API_PORT})) '')║"
echo "║  MongoDB           localhost:${HDX_DEV_MONGO_PORT}$(printf '%*s' $((29 - ${#HDX_DEV_MONGO_PORT})) '')║"
echo "╠══════════════════════════════════════════════════════════════╣"
echo "║  Portal:  http://localhost:${HDX_PORTAL_PORT}$(printf '%*s' $((28 - ${#HDX_PORTAL_PORT})) '')║"
echo "╚══════════════════════════════════════════════════════════════╝"
