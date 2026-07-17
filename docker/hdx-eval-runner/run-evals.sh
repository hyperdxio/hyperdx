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
# Optional env (with defaults):
#   HDX_EVAL_SCENARIO        default: latency-spike
#   HDX_EVAL_VOLUME_FACTOR   default: 0.01  (1% of full volume — scale up later)
#   HDX_EVAL_RUNS            default: 1
#   HDX_EVAL_MAX_TURNS       default: 15
#   HDX_EVAL_TIMEOUT_MS      default: 600000 (10m per run; slow is OK for M1)
#   HDX_EVAL_MCP             default: hyperdx
#   HDX_EVAL_OUT_COMMENT     default: /work/eval-output/verdict.md
#   HDX_EVAL_RUN_URL         workflow run URL (for the comment footer)
#   HDX_EVAL_COMMIT_SHA      commit SHA (for the comment footer)
#   HDX_EVAL_ANCHOR          fixed anchor ISO for deterministic seed timestamps
#                            (default: 2026-06-01T00:00:00Z — must be stable so a
#                            cached snapshot's timestamps stay valid across runs)
#
# ── M2 Parquet snapshot (fast seed) ────────────────────────────────────────
#   HDX_EVAL_SNAPSHOT_DIR    when set, enables the Parquet snapshot fast path.
#                            The workflow restores/saves this dir as an
#                            actions/cache entry keyed on the seed-logic hash.
#                            - dir has a manifest.json  → LOAD it (fast path)
#                            - dir empty/no manifest    → GENERATE at full volume,
#                              then EXPORT so the cache-save persists it
#   HDX_EVAL_SNAPSHOT_VOLUME_FACTOR
#                            volume factor to GENERATE at on a snapshot miss.
#                            default: 1 (FULL volume — the whole point of M2)
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
# Fixed anchor so a cached snapshot's seeded timestamps stay valid across runs.
ANCHOR="${HDX_EVAL_ANCHOR:-2026-06-01T00:00:00Z}"
SNAPSHOT_DIR="${HDX_EVAL_SNAPSHOT_DIR:-}"
SNAPSHOT_VOLUME_FACTOR="${HDX_EVAL_SNAPSHOT_VOLUME_FACTOR:-1}"

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

echo "::group::[2/5] Seed"
if [ -n "$SNAPSHOT_DIR" ]; then
  # ── M2 Parquet snapshot fast path ──
  # The workflow restores $SNAPSHOT_DIR from actions/cache (keyed on the
  # seed-logic hash) BEFORE this container runs. If the cache hit, the dir has
  # a manifest.json and we LOAD it (fast). If it missed, the dir is empty and
  # we GENERATE at full volume then EXPORT, so the workflow's cache-save step
  # persists the snapshot for the next run.
  SCEN_SNAP_DIR="$SNAPSHOT_DIR/$SCENARIO"
  if [ -f "$SCEN_SNAP_DIR/manifest.json" ]; then
    echo "Snapshot cache HIT → loading Parquet from $SCEN_SNAP_DIR"
    "${CLI[@]}" load-snapshot "$SCENARIO" --dir "$SCEN_SNAP_DIR"
  else
    echo "Snapshot cache MISS → generating full-volume seed (factor $SNAPSHOT_VOLUME_FACTOR) then exporting Parquet"
    "${CLI[@]}" seed "$SCENARIO" \
      --volume-factor "$SNAPSHOT_VOLUME_FACTOR" \
      --now "$ANCHOR"
    "${CLI[@]}" export-snapshot "$SCENARIO" \
      --dir "$SCEN_SNAP_DIR" \
      --volume-factor "$SNAPSHOT_VOLUME_FACTOR" \
      --anchor "$ANCHOR"
  fi
else
  # M1 path: plain low-volume live seed (no snapshot caching).
  "${CLI[@]}" seed "$SCENARIO" --volume-factor "$VOLUME_FACTOR" --now "$ANCHOR"
fi
echo "::endgroup::"

echo "::group::[3/5+4/5] Run + Grade"
# `run` auto-grades and auto-reports unless told otherwise. We let it do the
# grade + report inline so a single command drives stages 3–5. Pin the anchor
# to the SAME value the seed used so the agent's "now" matches the seeded
# timestamps. Data already exists (seeded or snapshot-loaded above), so `run`
# skips its auto-seed — no --reseed.
"${CLI[@]}" run "$SCENARIO" \
  --mcp "$MCP" \
  --runs "$RUNS" \
  --max-turns "$MAX_TURNS" \
  --timeout "$TIMEOUT_MS" \
  --anchor-time "$ANCHOR"
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
