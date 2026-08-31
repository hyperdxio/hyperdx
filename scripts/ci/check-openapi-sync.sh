#!/usr/bin/env bash
# Fails if the committed packages/api/openapi.json differs from what its sources
# generate. Runs outside nx on purpose: `ci:lint` lists openapi.json in its
# `outputs`, so a cache hit restores the spec rather than regenerating it, and
# `nx affected` skips the api on PRs that don't touch it.
set -euo pipefail

cd "$(dirname "$0")/../.."

SPEC=packages/api/openapi.json

# `swaggerOptions.apis` is a cwd-relative glob; from the repo root it matches
# nothing and emits an empty spec.
yarn workspace @hyperdx/api docgen

# Against the index, not HEAD, so staging the regenerated spec counts as fixed.
if git --no-pager diff --quiet -- "$SPEC"; then
  echo "$SPEC is in sync with its sources"
  exit 0
fi

diff_output=$(git --no-pager diff -- "$SPEC")
diff_lines=$(printf '%s\n' "$diff_output" | wc -l | tr -d ' ')
head -n 80 <<< "$diff_output"
if [ "$diff_lines" -gt 80 ]; then
  echo
  echo "  ... diff truncated, $diff_lines lines total"
fi
echo
echo "::error::$SPEC is out of date with its sources"
echo "$SPEC does not match what the JSDoc in"
echo "packages/api/src/routers/external-api/ and \`swaggerOptions\` in"
echo "packages/api/src/utils/swagger.ts generate. It has just been regenerated"
echo "in your working tree, so all that is left is to stage it:"
echo
echo "    git add $SPEC"
exit 1
