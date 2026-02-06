#!/bin/bash
# Stop E2E test infrastructure (MongoDB and ClickHouse containers)

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
DOCKER_COMPOSE_FILE="$REPO_ROOT/packages/app/tests/e2e/docker-compose.yml"

echo "Stopping E2E test infrastructure..."
docker compose -p e2e -f "$DOCKER_COMPOSE_FILE" down -v
echo "✅ E2E containers stopped and volumes removed"
