#!/bin/bash
# Run E2E tests in full-stack or local mode
# Full-stack mode (default): MongoDB + API + local ClickHouse
# Local mode: Frontend + local ClickHouse (no MongoDB/API)
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
#   docker compose -p e2e -f packages/app/tests/e2e/docker-compose.yml down -v
#
# All Playwright flags are passed through automatically

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
DOCKER_COMPOSE_FILE="$REPO_ROOT/packages/app/tests/e2e/docker-compose.yml"

# Configuration constants
readonly MAX_MONGODB_WAIT_ATTEMPTS=15
readonly MONGODB_WAIT_DELAY_SECONDS=1
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
  docker compose -p e2e -f "$DOCKER_COMPOSE_FILE" down -v
}

check_mongodb_health() {
  # Health check script that tests ping, insert, and delete operations
  # Note: MongoDB is configured to run on port 29998 inside the container
  docker compose -p e2e -f "$DOCKER_COMPOSE_FILE" exec -T db mongosh --port 29998 --quiet --eval "
    try {
      db.adminCommand('ping');
      db.getSiblingDB('test').test.insertOne({_id: 'healthcheck', ts: new Date()});
      db.getSiblingDB('test').test.deleteOne({_id: 'healthcheck'});
      print('ready');
    } catch(e) {
      print('not ready: ' + e);
      quit(1);
    }
  " 2>&1
}

check_clickhouse_health() {
  # Health check from HOST perspective (not inside container)
  # This ensures the port is actually accessible to Playwright
  curl -sf http://localhost:8123/ping >/dev/null 2>&1 || wget --spider -q http://localhost:8123/ping 2>&1
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
      echo "Try running: docker compose -p e2e -f $DOCKER_COMPOSE_FILE logs ch-server"
      return 1
    fi

    echo "Waiting for ClickHouse... ($attempt/$MAX_CLICKHOUSE_WAIT_ATTEMPTS)"
    attempt=$((attempt + 1))
    sleep $CLICKHOUSE_WAIT_DELAY_SECONDS
  done
}

wait_for_mongodb() {
  echo "Waiting for MongoDB to be ready..."
  local attempt=1

  # Verify mongosh is available in the container
  if ! docker compose -p e2e -f "$DOCKER_COMPOSE_FILE" exec -T db which mongosh >/dev/null 2>&1; then
    echo "ERROR: mongosh not found in MongoDB container"
    echo "Container may not be running or using incompatible image"
    echo "Try running: docker compose -p e2e -f $DOCKER_COMPOSE_FILE logs db"
    return 1
  fi

  while [ $attempt -le $MAX_MONGODB_WAIT_ATTEMPTS ]; do
    local result
    result=$(check_mongodb_health)

    if echo "$result" | grep -q "ready"; then
      echo "MongoDB is ready and accepting writes"
      return 0
    fi

    if [ $attempt -eq $MAX_MONGODB_WAIT_ATTEMPTS ]; then
      local total_wait=$((MAX_MONGODB_WAIT_ATTEMPTS * MONGODB_WAIT_DELAY_SECONDS))
      echo "MongoDB failed to become ready after $total_wait seconds"
      echo "Last error: $result"
      return 1
    fi

    echo "Waiting for MongoDB... ($attempt/$MAX_MONGODB_WAIT_ATTEMPTS)"
    attempt=$((attempt + 1))
    sleep $MONGODB_WAIT_DELAY_SECONDS
  done
}

# Main execution
setup_cleanup_trap() {
  if [ "$SKIP_CLEANUP" = false ]; then
    trap cleanup_services EXIT ERR
  else
    echo "⚠️  Skipping cleanup - containers will remain running"
    echo "   Use 'docker compose -p e2e -f $DOCKER_COMPOSE_FILE down -v' to stop them manually"
  fi
}

setup_clickhouse() {
  echo "Starting ClickHouse..."
  docker compose -p e2e -f "$DOCKER_COMPOSE_FILE" up -d ch-server

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
    echo "Running tests in full-stack mode (MongoDB + API + ClickHouse)..."
    yarn test:e2e "${PLAYWRIGHT_FLAGS[@]}"
  fi
}

# Set up cleanup trap
setup_cleanup_trap

# Always start and seed ClickHouse (shared by both modes)
setup_clickhouse

# Conditionally start MongoDB for full-stack mode
if [ "$LOCAL_MODE" = false ]; then
  echo "Starting MongoDB for full-stack mode..."
  docker compose -p e2e -f "$DOCKER_COMPOSE_FILE" up -d db
  
  if ! wait_for_mongodb; then
    exit 1
  fi
fi

# Run tests
run_tests
