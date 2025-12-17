#!/bin/bash
# Run E2E tests in full-stack or local mode
# Full-stack mode (default): MongoDB + API + demo ClickHouse
# Local mode: Frontend only, no backend

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
DOCKER_COMPOSE_FILE="$REPO_ROOT/packages/app/tests/e2e/docker-compose.yml"

# Configuration constants
readonly MAX_MONGODB_WAIT_ATTEMPTS=15
readonly MONGODB_WAIT_DELAY_SECONDS=1

# Parse arguments
LOCAL_MODE=false
TAGS=""

while [[ $# -gt 0 ]]; do
  case $1 in
    --local)
      LOCAL_MODE=true
      shift
      ;;
    --tags)
      TAGS="$2"
      shift 2
      ;;
    *)
      echo "Unknown option: $1"
      echo "Usage: $0 [--local] [--tags <tag>]"
      exit 1
      ;;
  esac
done

cleanup_mongodb() {
  echo "Stopping MongoDB..."
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

run_local_mode() {
  echo "Running E2E tests in local mode (frontend only)..."
  cd "$REPO_ROOT/packages/app"
  if [ -n "$TAGS" ]; then
    yarn test:e2e --grep "$TAGS" --grep-invert "@full-stack"
  else
    yarn test:e2e --grep-invert "@full-stack"
  fi
}

run_fullstack_mode() {
  echo "Running E2E tests in full-stack mode (MongoDB + API + demo ClickHouse)..."

  # Set up cleanup trap for both normal exit and errors
  trap cleanup_mongodb EXIT ERR

  # Start MongoDB
  echo "Starting MongoDB for full-stack tests..."
  docker compose -p e2e -f "$DOCKER_COMPOSE_FILE" up -d

  # Wait for MongoDB to be ready
  if ! wait_for_mongodb; then
    exit 1
  fi

  # Run tests with full-stack flag
  cd "$REPO_ROOT/packages/app"
  if [ -n "$TAGS" ]; then
    E2E_FULLSTACK=true yarn test:e2e --grep "$TAGS"
  else
    E2E_FULLSTACK=true yarn test:e2e
  fi
}

# Main execution
if [ "$LOCAL_MODE" = true ]; then
  run_local_mode
else
  run_fullstack_mode
fi
