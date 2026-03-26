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
# Port allocation scheme — each service gets a 100-wide band in the 30100-31199
# range, well clear of:
#   - CI integration test ports (14320-14419, 18123-18222, 19000-19099, 39999-40098)
#   - E2E test ports           (8123, 9000, 24320, 28081, 29000, 29998)
#   - Default dev ports        (4317-4320, 8000, 8080, 8123, 8888, 9000, 13133, 14318, 27017)
#   - OS ephemeral ports       (32768+ Linux, 49152+ macOS)
#
# Port mapping (base + slot):
#   API server        : 30100 + slot   (HYPERDX_API_PORT)
#   App (Next.js)     : 30200 + slot   (HYPERDX_APP_PORT)
#   OpAMP             : 30300 + slot   (HYPERDX_OPAMP_PORT)
#   MongoDB           : 30400 + slot   (HDX_DEV_MONGO_PORT)
#   ClickHouse HTTP   : 30500 + slot   (HDX_DEV_CH_HTTP_PORT)
#   ClickHouse Native : 30600 + slot   (HDX_DEV_CH_NATIVE_PORT)
#   OTel health       : 30700 + slot   (HDX_DEV_OTEL_HEALTH_PORT)
#   OTel gRPC         : 30800 + slot   (HDX_DEV_OTEL_GRPC_PORT)
#   OTel HTTP         : 30900 + slot   (HDX_DEV_OTEL_HTTP_PORT)
#   OTel metrics      : 31000 + slot   (HDX_DEV_OTEL_METRICS_PORT)
#   OTel JSON HTTP    : 31100 + slot   (HDX_DEV_OTEL_JSON_HTTP_PORT)
# ---------------------------------------------------------------------------

# Compute slot from directory name (same algorithm as CI slot in Makefile)
HDX_DEV_SLOT="${HDX_DEV_SLOT:-$(printf '%s' "$(basename "$PWD")" | cksum | awk '{print $1 % 100}')}"

# Git metadata for portal labels
HDX_DEV_BRANCH="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo 'unknown')"
HDX_DEV_WORKTREE="$(basename "$PWD")"

# --- Application ports (30100-30399) ---
HYPERDX_API_PORT=$((30100 + HDX_DEV_SLOT))
HYPERDX_APP_PORT=$((30200 + HDX_DEV_SLOT))
HYPERDX_OPAMP_PORT=$((30300 + HDX_DEV_SLOT))

# --- Docker service ports (30400-31199) ---
HDX_DEV_MONGO_PORT=$((30400 + HDX_DEV_SLOT))
HDX_DEV_CH_HTTP_PORT=$((30500 + HDX_DEV_SLOT))
HDX_DEV_CH_NATIVE_PORT=$((30600 + HDX_DEV_SLOT))
HDX_DEV_OTEL_HEALTH_PORT=$((30700 + HDX_DEV_SLOT))
HDX_DEV_OTEL_GRPC_PORT=$((30800 + HDX_DEV_SLOT))
HDX_DEV_OTEL_HTTP_PORT=$((30900 + HDX_DEV_SLOT))
HDX_DEV_OTEL_METRICS_PORT=$((31000 + HDX_DEV_SLOT))
HDX_DEV_OTEL_JSON_HTTP_PORT=$((31100 + HDX_DEV_SLOT))

# --- Docker Compose project name (unique per slot) ---
HDX_DEV_PROJECT="hdx-dev-${HDX_DEV_SLOT}"

# Export everything
export HDX_DEV_SLOT
export HDX_DEV_BRANCH
export HDX_DEV_WORKTREE
export HYPERDX_API_PORT
export HYPERDX_APP_PORT
export HYPERDX_OPAMP_PORT
export HDX_DEV_MONGO_PORT
export HDX_DEV_CH_HTTP_PORT
export HDX_DEV_CH_NATIVE_PORT
export HDX_DEV_OTEL_HEALTH_PORT
export HDX_DEV_OTEL_GRPC_PORT
export HDX_DEV_OTEL_HTTP_PORT
export HDX_DEV_OTEL_METRICS_PORT
export HDX_DEV_OTEL_JSON_HTTP_PORT
export HDX_DEV_PROJECT

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

# Clean up slot file and logs on exit
_hdx_cleanup_slot() {
  rm -f "${HDX_DEV_SLOTS_DIR}/${HDX_DEV_SLOT}.json" 2>/dev/null || true
  rm -rf "${HDX_DEV_LOGS_DIR}" 2>/dev/null || true
  rmdir "${HDX_DEV_SLOTS_DIR}/${HDX_DEV_SLOT}" 2>/dev/null || true
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
echo "║  Portal:  http://localhost:9900  (run: make dev-portal)     ║"
echo "╚══════════════════════════════════════════════════════════════╝"
