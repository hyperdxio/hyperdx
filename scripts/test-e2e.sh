#!/bin/bash
# Run E2E tests in full-stack or local mode
# Full-stack mode (default): DocumentDB + API + local ClickHouse
# Local mode: Frontend + local ClickHouse (no DocumentDB/API)
#
# Usage:
#   ./scripts/test-e2e.sh                      # Run all tests in fullstack mode
#   ./scripts/test-e2e.sh --local              # Run in local mode (frontend + ClickHouse only)
#   ./scripts/test-e2e.sh --keep-running       # Keep containers running after tests (fast iteration!)
#   ./scripts/test-e2e.sh --ui                 # Run with Playwright UI
#   ./scripts/test-e2e.sh --last-failed        # Run only failed tests
#   ./scripts/test-e2e.sh --headed             # Run with visible browser
#   ./scripts/test-e2e.sh --debug              # Run in debug mode
#   ./scripts/test-e2e.sh --grep "dashboard"   # Run tests matching pattern
#
# Development workflow (recommended):
#   ./scripts/test-e2e.sh --keep-running --ui  # Start containers and open UI
#   # Make changes, tests auto-rerun in UI mode
#   # When done:
#   docker compose -p e2e-<slot> -f packages/app/tests/e2e/docker-compose.yml down -v
#
# All Playwright flags are passed through automatically

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
DOCKER_COMPOSE_FILE="$REPO_ROOT/packages/app/tests/e2e/docker-compose.yml"

# ---------------------------------------------------------------------------
# Multi-agent / worktree isolation
# ---------------------------------------------------------------------------
# E2E gets its own slot and port range so worktrees can run E2E tests in
# parallel with each other, the dev stack, and integration tests. See
# scripts/slots.sh for the ports. Override with HDX_E2E_SLOT.
# ---------------------------------------------------------------------------
# shellcheck source=./slots.sh
. "$SCRIPT_DIR/slots.sh"
hdx_e2e_ports "$REPO_ROOT"

# Prevent Playwright's html reporter from spawning a blocking server on port
# 9323 ("Serving HTML report... Press Ctrl+C to quit.") after a failed/flaky
# run. Without this, the test process never exits in interactive terminals,
# which breaks non-interactive (agent) invocations of `make dev-e2e`.
# The Makefile's `REPORT=1` flag still works because it invokes
# `npx playwright show-report` separately after the test process exits.
# CI is already unaffected (Playwright skips auto-open when process.env.CI is set).
export PLAYWRIGHT_HTML_OPEN=never

# --- Log capture for dev-portal visibility ---
HDX_E2E_SLOTS_DIR="${HOME}/.config/hyperdx/dev-slots"
HDX_E2E_LOGS_DIR="${HDX_E2E_SLOTS_DIR}/${HDX_E2E_SLOT}/logs-e2e"
mkdir -p "$HDX_E2E_LOGS_DIR"
exec > >(tee "$HDX_E2E_LOGS_DIR/e2e.log") 2>&1

# --- Start dev portal in background if not already running ---
# shellcheck source=./ensure-dev-portal.sh
source "${REPO_ROOT}/scripts/ensure-dev-portal.sh"

echo "Using E2E slot ${HDX_E2E_SLOT} (project=${E2E_PROJECT} ch=${HDX_E2E_CH_PORT} ch-native=${HDX_E2E_CH_NATIVE_PORT} db=${HDX_E2E_MONGO_PORT} api=${HDX_E2E_API_PORT} app=${HDX_E2E_APP_PORT} app-local=${HDX_E2E_APP_LOCAL_PORT} opamp=${HDX_E2E_OPAMP_PORT})"

# Configuration constants
readonly MAX_CLICKHOUSE_WAIT_ATTEMPTS=30
readonly CLICKHOUSE_WAIT_DELAY_SECONDS=1

# Parse arguments
LOCAL_MODE=false
SKIP_CLEANUP=false
PLAYWRIGHT_FLAGS=()

while [[ $# -gt 0 ]]; do
  case $1 in
    --local)
      LOCAL_MODE=true
      shift
      ;;
    --keep-running|--no-cleanup)
      SKIP_CLEANUP=true
      shift
      ;;
    *)
      # Pass any other flags through to Playwright
      PLAYWRIGHT_FLAGS+=("$1")
      shift
      ;;
  esac
done


cleanup_services() {
  echo "Stopping E2E services and removing volumes..."
  docker compose -p "$E2E_PROJECT" -f "$DOCKER_COMPOSE_FILE" down -v
  # Archive logs to history instead of deleting
  if [ -d "$HDX_E2E_LOGS_DIR" ] && [ -n "$(ls -A "$HDX_E2E_LOGS_DIR" 2>/dev/null)" ]; then
    _ts=$(date -u +%Y-%m-%dT%H:%M:%SZ)
    _hist="${HDX_E2E_SLOTS_DIR}/${HDX_E2E_SLOT}/history/e2e-${_ts}"
    mkdir -p "$_hist"
    mv "$HDX_E2E_LOGS_DIR"/* "$_hist/" 2>/dev/null || true
    _wt=$(basename "$(git -C "$REPO_ROOT" rev-parse --show-toplevel 2>/dev/null || echo "$REPO_ROOT")")
    _br=$(git -C "$REPO_ROOT" rev-parse --abbrev-ref HEAD 2>/dev/null || echo "unknown")
    cat > "$_hist/meta.json" <<METAEOF
{"worktree":"${_wt}","branch":"${_br}","worktreePath":"${REPO_ROOT}"}
METAEOF
  fi
  rm -rf "$HDX_E2E_LOGS_DIR" 2>/dev/null || true
}

check_clickhouse_health() {
  # Health check from HOST perspective (not inside container)
  # This ensures the port is actually accessible to Playwright
  curl -sf "http://localhost:${HDX_E2E_CH_PORT}/ping" >/dev/null 2>&1 || wget --spider -q "http://localhost:${HDX_E2E_CH_PORT}/ping" 2>&1
}

wait_for_clickhouse() {
  echo "Waiting for ClickHouse to be ready..."
  local attempt=1

  while [ $attempt -le $MAX_CLICKHOUSE_WAIT_ATTEMPTS ]; do
    if check_clickhouse_health >/dev/null 2>&1; then
      echo "ClickHouse is ready"
      return 0
    fi

    if [ $attempt -eq $MAX_CLICKHOUSE_WAIT_ATTEMPTS ]; then
      local total_wait=$((MAX_CLICKHOUSE_WAIT_ATTEMPTS * CLICKHOUSE_WAIT_DELAY_SECONDS))
      echo "ClickHouse failed to become ready after $total_wait seconds"
      echo "Try running: docker compose -p $E2E_PROJECT -f $DOCKER_COMPOSE_FILE logs ch-server"
      return 1
    fi

    echo "Waiting for ClickHouse... ($attempt/$MAX_CLICKHOUSE_WAIT_ATTEMPTS)"
    attempt=$((attempt + 1))
    sleep $CLICKHOUSE_WAIT_DELAY_SECONDS
  done
}

# Main execution
setup_cleanup_trap() {
  if [ "$SKIP_CLEANUP" = false ]; then
    trap cleanup_services EXIT ERR
  else
    echo "⚠️  Skipping cleanup - containers will remain running"
    echo "   Use 'docker compose -p $E2E_PROJECT -f $DOCKER_COMPOSE_FILE down -v' to stop them manually"
  fi
}

setup_clickhouse() {
  echo "Starting ClickHouse..."
  docker compose -p "$E2E_PROJECT" -f "$DOCKER_COMPOSE_FILE" up -d ch-server

  if ! wait_for_clickhouse; then
    exit 1
  fi
  
  # Note: ClickHouse seeding is handled by Playwright global setup
  # - Fullstack mode: global-setup-fullstack.ts
  # - Local mode: global-setup-local.ts
}

run_tests() {
  cd "$REPO_ROOT/packages/app"
  
  if [ "$LOCAL_MODE" = true ]; then
    echo "Running tests in local mode (frontend + ClickHouse)..."
    yarn test:e2e --local "${PLAYWRIGHT_FLAGS[@]}"
  else
    echo "Running tests in full-stack mode (DocumentDB + API + ClickHouse)..."
    yarn test:e2e "${PLAYWRIGHT_FLAGS[@]}"
  fi
}

# Set up cleanup trap
setup_cleanup_trap

# Clean up E2E Next.js build directory to avoid stale lock/cache issues
rm -rf "$REPO_ROOT/packages/app/.next-e2e" 2>/dev/null || true

# Always start and seed ClickHouse (shared by both modes)
setup_clickhouse

# Conditionally start DocumentDB for full-stack mode
if [ "$LOCAL_MODE" = false ]; then
  echo "Starting DocumentDB for full-stack mode..."
  # --wait blocks on the image healthcheck, which passes once the gateway accepts connections.
  if ! docker compose -p "$E2E_PROJECT" -f "$DOCKER_COMPOSE_FILE" up -d --build --wait --wait-timeout 300 db; then
    echo "DocumentDB failed to become healthy"
    docker compose -p "$E2E_PROJECT" -f "$DOCKER_COMPOSE_FILE" logs db | tail -20
    exit 1
  fi
fi

# Run tests
run_tests
