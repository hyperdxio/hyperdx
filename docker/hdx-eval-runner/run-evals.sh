#!/usr/bin/env bash
#
# HDX-4755 / HDX-4756 — M1 eval pipeline orchestration (runner container).
#
# Runs all five stages end to end against a containerized HyperDX instance:
#   Setup  → register eval account, create Connection + Sources, write config
#   Seed   → low-volume synthetic telemetry into ClickHouse
#   Run    → spawn the Claude agent against the HyperDX MCP, record trajectory
#   Grade  → programmatic checks + LLM-as-judge
#   Report → aggregate _summary.{md,json} and render the PR-comment verdict
#
# Speed is explicitly NOT a goal for M1 — correctness and running to completion
# are. The seed volume is turned WAY down (not the seed mechanism itself) via
# HDX_EVAL_VOLUME_FACTOR so the skeleton finishes in minutes.
#
# Required env:
#   ANTHROPIC_API_KEY       API key for the agent + LLM judge
#   HDX_EVAL_API_URL        HyperDX API base URL as the runner sees it
#                           (e.g. http://hyperdx:8000)
#   HDX_EVAL_CH_URL         ClickHouse HTTP URL as the runner sees it
#                           (e.g. http://hyperdx:8123)
#   HDX_EVAL_CONNECTION_CH_URL
#                           ClickHouse HTTP URL as the HyperDX API sees it
#                           (e.g. http://localhost:8123 for the all-in-one image)
#
# Optional env (with M1 defaults):
#   HDX_EVAL_SCENARIO        default: latency-spike
#   HDX_EVAL_VOLUME_FACTOR   default: 0.01  (1% of full volume — scale up later)
#   HDX_EVAL_RUNS            default: 1
#   HDX_EVAL_MAX_TURNS       default: 15
#   HDX_EVAL_TIMEOUT_MS      default: 600000 (10m per run; slow is OK for M1)
#   HDX_EVAL_MCP             default: hyperdx
#   HDX_EVAL_OUT_COMMENT     default: /work/eval-output/verdict.md
#   HDX_EVAL_RUN_URL         workflow run URL (for the comment footer)
#   HDX_EVAL_COMMIT_SHA      commit SHA (for the comment footer)
#
# The verdict is completion-only and ADVISORY: this script exits 0 as long as
# it produced a summary + verdict, even if the verdict is FAIL. Genuine
# infrastructure failures (setup/seed/report throwing) still exit non-zero so
# CI surfaces a broken skeleton.

set -euo pipefail

SCENARIO="${HDX_EVAL_SCENARIO:-latency-spike}"
VOLUME_FACTOR="${HDX_EVAL_VOLUME_FACTOR:-0.01}"
RUNS="${HDX_EVAL_RUNS:-1}"
MAX_TURNS="${HDX_EVAL_MAX_TURNS:-15}"
TIMEOUT_MS="${HDX_EVAL_TIMEOUT_MS:-600000}"
MCP="${HDX_EVAL_MCP:-hyperdx}"
OUT_COMMENT="${HDX_EVAL_OUT_COMMENT:-/work/eval-output/verdict.md}"

: "${ANTHROPIC_API_KEY:?ANTHROPIC_API_KEY is required}"
: "${HDX_EVAL_API_URL:?HDX_EVAL_API_URL is required (e.g. http://hyperdx:8000)}"
: "${HDX_EVAL_CH_URL:?HDX_EVAL_CH_URL is required (e.g. http://hyperdx:8123)}"

# Connection CH URL defaults to the API self-view for the all-in-one image.
CONNECTION_CH_URL="${HDX_EVAL_CONNECTION_CH_URL:-http://localhost:8123}"

# Run the CLI straight through tsx (no scripts/env.sh — that sources the
# slot-based dev-env.sh + dotenvx, which are for local host dev only). Env is
# passed explicitly below.
cd /work/packages/hdx-eval
CLI=(yarn exec tsx src/cli.ts --ch-url "$HDX_EVAL_CH_URL")

echo "=============================================="
echo " HyperDX MCP Evals — M1 CI skeleton"
echo "   scenario:      $SCENARIO"
echo "   volumeFactor:  $VOLUME_FACTOR"
echo "   runs:          $RUNS"
echo "   mcp:           $MCP"
echo "   api:           $HDX_EVAL_API_URL"
echo "   clickhouse:    $HDX_EVAL_CH_URL  (API view: $CONNECTION_CH_URL)"
echo "=============================================="

echo "::group::[1/5] Setup"
"${CLI[@]}" setup-hyperdx \
  --api-url "$HDX_EVAL_API_URL" \
  --connection-ch-url "$CONNECTION_CH_URL"
echo "::endgroup::"

echo "::group::[2/5] Seed (low volume)"
"${CLI[@]}" seed "$SCENARIO" --volume-factor "$VOLUME_FACTOR"
echo "::endgroup::"

echo "::group::[3/5+4/5] Run + Grade"
# `run` auto-grades and auto-reports unless told otherwise. We let it do the
# grade + report inline so a single command drives stages 3–5. --reseed is not
# passed: the seed above already loaded data, and run reuses it.
"${CLI[@]}" run "$SCENARIO" \
  --mcp "$MCP" \
  --runs "$RUNS" \
  --max-turns "$MAX_TURNS" \
  --timeout "$TIMEOUT_MS"
echo "::endgroup::"

# Find the batch produced by the run (newest directory under runs/).
BATCH="$(ls -1t runs 2>/dev/null | head -n1 || true)"
if [ -z "$BATCH" ]; then
  echo "::error::No batch directory was produced under runs/ — the run stage did not complete."
  exit 1
fi
echo "Batch: $BATCH"

echo "::group::[5/5] Report + verdict"
# Re-run report explicitly to be robust even if --no-report was ever set, then
# render the advisory PR-comment verdict.
"${CLI[@]}" report "$BATCH"
mkdir -p "$(dirname "$OUT_COMMENT")"
"${CLI[@]}" report-pr "$BATCH" \
  --out "$OUT_COMMENT" \
  ${HDX_EVAL_RUN_URL:+--run-url "$HDX_EVAL_RUN_URL"} \
  ${HDX_EVAL_COMMIT_SHA:+--commit "$HDX_EVAL_COMMIT_SHA"}
echo "::endgroup::"

echo "Wrote verdict comment to $OUT_COMMENT"
echo "Done."
