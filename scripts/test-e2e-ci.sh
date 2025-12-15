#!/bin/bash
# Run E2E tests in Docker with exact CI environment
# This replicates the GitHub Actions CI environment locally for debugging

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

echo "Running E2E tests in CI Docker environment..."
echo "Repository root: $REPO_ROOT"

docker run --rm \
  -v "$REPO_ROOT:/workspace" \
  -w /workspace \
  -e CI=true \
  mcr.microsoft.com/playwright:v1.57.0-jammy \
  bash -c '
    # Clean all build artifacts and dependencies
    rm -rf packages/app/.next packages/common-utils/dist node_modules packages/*/node_modules .yarn/cache
    
    # Fresh install
    corepack enable
    yarn install
    
    # Build in production mode
    npx nx run-many -t ci:build
    
    # Run tests
    cd packages/app
    yarn test:e2e
    
    # Fix permissions so host can read results
    chmod -R 777 test-results playwright-report 2>/dev/null || true
  '

echo "Done! Check packages/app/test-results/ for results"