#!/usr/bin/env bash
#
# Upsert a single sticky PR comment from inside the eval runner so the suite's
# verdict updates LIVE as each scenario finishes, instead of only once at the
# end.
#
# CRITICAL — marker must match the workflow's final mshick/add-pr-comment step.
# mshick identifies its sticky comment by a hidden marker derived from its
# `message-id` input: `<!-- add-pr-comment:<message-id> -->`. We upsert against
# that SAME marker so the progressive updates and the final mshick post edit ONE
# comment instead of creating two. Keep HDX_EVAL_GH_COMMENT_MARKER in sync with
# the `message-id` value in .github/workflows/evals.yml.
#
# No-op unless all of HDX_EVAL_GH_TOKEN, HDX_EVAL_GH_REPO (owner/repo) and
# HDX_EVAL_GH_PR are set. Best-effort: any failure exits non-zero but the caller
# swallows it so a flaky comment update never breaks the eval run.
#
# Usage: post-comment.sh <path-to-markdown-body>

set -euo pipefail

BODY_FILE="${1:?usage: post-comment.sh <body-file>}"
: "${HDX_EVAL_GH_TOKEN:?HDX_EVAL_GH_TOKEN required}"
: "${HDX_EVAL_GH_REPO:?HDX_EVAL_GH_REPO required (owner/repo)}"
: "${HDX_EVAL_GH_PR:?HDX_EVAL_GH_PR required}"

# Must equal `<!-- add-pr-comment:<message-id> -->` for the message-id used by
# the mshick/add-pr-comment step in evals.yml (default: mcp-eval-verdict).
MARKER="${HDX_EVAL_GH_COMMENT_MARKER:-<!-- add-pr-comment:mcp-eval-verdict -->}"
API="https://api.github.com"
AUTH=(-H "Authorization: Bearer ${HDX_EVAL_GH_TOKEN}"
  -H "Accept: application/vnd.github+json"
  -H "X-GitHub-Api-Version: 2022-11-28")

# Build the JSON body payload safely (escape via jq). Prepend the mshick marker
# so THIS comment is the one the final mshick/add-pr-comment step also matches
# and edits in place (single sticky comment across progressive + final posts).
payload="$(
  { printf '%s\n\n' "$MARKER"; cat "$BODY_FILE"; } | jq -Rs '{body: .}'
)"

# Find an existing sticky comment carrying our marker (first match wins).
existing_id="$(
  curl -fsSL "${AUTH[@]}" \
    "${API}/repos/${HDX_EVAL_GH_REPO}/issues/${HDX_EVAL_GH_PR}/comments?per_page=100" |
    jq -r --arg m "$MARKER" \
      'map(select(.body | contains($m))) | (.[0].id // empty)'
)" || existing_id=""

if [ -n "$existing_id" ]; then
  curl -fsSL -X PATCH "${AUTH[@]}" \
    "${API}/repos/${HDX_EVAL_GH_REPO}/issues/comments/${existing_id}" \
    -d "$payload" >/dev/null
  echo "  Updated sticky eval comment (#${existing_id})."
else
  curl -fsSL -X POST "${AUTH[@]}" \
    "${API}/repos/${HDX_EVAL_GH_REPO}/issues/${HDX_EVAL_GH_PR}/comments" \
    -d "$payload" >/dev/null
  echo "  Created sticky eval comment."
fi
