#!/usr/bin/env bash
# Single source of truth for which trusted inputs the review gate covers.
#
# Called twice: once before the review to compute the gate's prompt_hash, once after to
# confirm the reviewer did not modify what the later steps execute. Duplicating the file
# list between those two callers meant a future trusted input added to only one copy would
# fail the verify step on every run with a misleading "the reviewer wrote to the workspace",
# and re-pay for every push forever.
#
# __tests__ is excluded on purpose: a test-only edit must not invalidate the gate for every
# open PR.
set -euo pipefail
root="${1:?usage: trusted-hash.sh <trusted-root>}"
find "$root/.github/prompts/code-review.md" \
  "$root/.github/scripts/code-review" \
  "$root/.github/workflows/claude-code-review.yml" \
  -type f -not -path '*/__tests__/*' -print0 |
  sort -z | xargs -0 sha256sum | sha256sum | cut -d' ' -f1
