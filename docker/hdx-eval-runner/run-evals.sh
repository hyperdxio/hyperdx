#!/usr/bin/env bash
#
# HDX-4755 / HDX-4756 — eval pipeline orchestration (runner container).
#
# Runs all five stages end to end against a containerized HyperDX instance,
# for ONE OR MORE scenarios accumulated into a single batch:
#   Setup  → register eval account, create Connection + Sources (all scenarios)
#   Seed   → synthetic telemetry into ClickHouse (per scenario)
#   Run    → spawn the Claude agent against the HyperDX MCP, record trajectory
#   Grade  → programmatic checks + LLM-as-judge (per scenario, inline)
#   Report → aggregate _summary.{md,json} across ALL scenarios + render verdict
#
# ── Suite mode ─────────────────────────────────────────────────────────────
# HDX_EVAL_SCENARIOS is a comma-separated list of scenarios to run as one suite
# (default: the full suite). Each scenario is seeded, run, and graded in turn,
# all writing into a SINGLE shared batch dir so the final report aggregates the
# whole suite into one verdict. After each scenario finishes we re-render the
# partial verdict and (when GitHub creds are present) UPDATE a sticky PR comment
# so progress is visible live instead of only at the end.
#
# Scenario tables coexist (each scenario has its own eval_<slug>_* tables), but
# we DROP each scenario's tables right after its run to keep ClickHouse small
# across the suite. The Parquet snapshot on disk is the durable copy.
#
# Required env:
#   ANTHROPIC_API_KEY       API key for the agent + LLM judge
#   HDX_EVAL_API_URL        HyperDX API base URL as the runner sees it
#   HDX_EVAL_CH_URL         ClickHouse HTTP URL as the runner sees it
#   HDX_EVAL_CONNECTION_CH_URL
#                           ClickHouse HTTP URL as the HyperDX API sees it
#
# Optional env (with defaults):
#   HDX_EVAL_SCENARIOS       comma list of scenarios (default: full suite)
#   HDX_EVAL_VOLUME_FACTOR   default: 0.01  (live-seed fallback only)
#   HDX_EVAL_RUNS            default: 1
#   HDX_EVAL_MAX_TURNS       default: 15
#   HDX_EVAL_TIMEOUT_MS      default: 600000 (10m per run)
#   HDX_EVAL_MCP             default: hyperdx
#   HDX_EVAL_CONCURRENCY     default: 1  (cells run concurrently within a scenario)
#   HDX_EVAL_OUT_COMMENT     default: /work/eval-output/verdict.md
#   HDX_EVAL_RUN_URL         workflow run URL (for the comment footer)
#   HDX_EVAL_COMMIT_SHA      commit SHA (for the comment footer)
#   HDX_EVAL_ANCHOR          fixed anchor ISO for deterministic seed timestamps
#
# Progressive PR comment (optional — no-op if unset):
#   HDX_EVAL_GH_TOKEN        GitHub token with pull-requests:write
#   HDX_EVAL_GH_REPO         owner/repo (e.g. hyperdxio/hyperdx)
#   HDX_EVAL_GH_PR           PR number
#
# ── Parquet snapshot (fast seed) ───────────────────────────────────────────
#   HDX_EVAL_SNAPSHOT_DIR    when set, enables the Parquet snapshot fast path.
#                            Per scenario: dir/<scenario>/manifest.json present
#                            → LOAD it; otherwise GENERATE at full volume then
#                            EXPORT so the workflow's cache-save persists it.
#   HDX_EVAL_SNAPSHOT_VOLUME_FACTOR
#                            volume factor to GENERATE at on a snapshot miss.
#                            default: 0.5 (half volume — suite-scale subset)
#
# The verdict is completion-only and ADVISORY: this script exits 0 as long as
# it produced a summary + verdict, even if the verdict is FAIL. Genuine
# infrastructure failures (setup/seed/report throwing) still exit non-zero.

set -euo pipefail

# Full suite in a stable, cheap-first order (light scenarios first so the
# progressive comment shows results ASAP, heaviest last).
DEFAULT_SUITE="dashboard-build,latency-spike,segmented-regression,error-root-cause,noisy-signals,service-health-check"

SCENARIOS_CSV="${HDX_EVAL_SCENARIOS:-${HDX_EVAL_SCENARIO:-$DEFAULT_SUITE}}"
VOLUME_FACTOR="${HDX_EVAL_VOLUME_FACTOR:-0.01}"
RUNS="${HDX_EVAL_RUNS:-1}"
MAX_TURNS="${HDX_EVAL_MAX_TURNS:-15}"
TIMEOUT_MS="${HDX_EVAL_TIMEOUT_MS:-600000}"
MCP="${HDX_EVAL_MCP:-hyperdx}"
CONCURRENCY="${HDX_EVAL_CONCURRENCY:-1}"
OUT_COMMENT="${HDX_EVAL_OUT_COMMENT:-/work/eval-output/verdict.md}"
# Fixed anchor so a cached snapshot's seeded timestamps stay valid across runs.
ANCHOR="${HDX_EVAL_ANCHOR:-2026-06-01T00:00:00Z}"
SNAPSHOT_DIR="${HDX_EVAL_SNAPSHOT_DIR:-}"
SNAPSHOT_VOLUME_FACTOR="${HDX_EVAL_SNAPSHOT_VOLUME_FACTOR:-0.5}"

: "${ANTHROPIC_API_KEY:?ANTHROPIC_API_KEY is required}"
: "${HDX_EVAL_API_URL:?HDX_EVAL_API_URL is required (e.g. http://hyperdx:8000)}"
: "${HDX_EVAL_CH_URL:?HDX_EVAL_CH_URL is required (e.g. http://hyperdx:8123)}"

# Connection CH URL defaults to the API self-view for the all-in-one image.
CONNECTION_CH_URL="${HDX_EVAL_CONNECTION_CH_URL:-http://localhost:8123}"

# Run the CLI straight through tsx. Env is passed explicitly below.
cd /work/packages/hdx-eval
CLI=(yarn exec tsx src/cli.ts --ch-url "$HDX_EVAL_CH_URL")

# One shared batch dir for the whole suite so the final report aggregates every
# scenario into a single verdict. Deterministic name → easy to find later.
BATCH="suite-$(date -u +%Y-%m-%dT%H-%M-%SZ)"

IFS=',' read -r -a SCENARIOS <<<"$SCENARIOS_CSV"
TOTAL="${#SCENARIOS[@]}"

echo "=============================================="
echo " HyperDX MCP Evals — full-suite run"
echo "   scenarios:     ${SCENARIOS_CSV} ($TOTAL)"
echo "   batch:         $BATCH"
echo "   runs/cell:     $RUNS   concurrency: $CONCURRENCY"
echo "   snapshotVF:    $SNAPSHOT_VOLUME_FACTOR   liveVF(fallback): $VOLUME_FACTOR"
echo "   mcp:           $MCP"
echo "   api:           $HDX_EVAL_API_URL"
echo "   clickhouse:    $HDX_EVAL_CH_URL  (API view: $CONNECTION_CH_URL)"
echo "=============================================="

# ── Progressive PR comment helper ──────────────────────────────────────────
# Renders the CURRENT partial batch to $OUT_COMMENT and, when GitHub creds are
# present, upserts a single sticky comment (marker-matched) on the PR. Safe to
# call repeatedly; a failure here never aborts the suite.
POST_SH="/work/docker/hdx-eval-runner/post-comment.sh"
render_and_post() {
  local progress_note="$1"
  # Regenerate the aggregate summary over whatever is graded so far, then
  # render the advisory verdict comment. Both are best-effort.
  if "${CLI[@]}" report "$BATCH" >/dev/null 2>&1; then
    "${CLI[@]}" report-pr "$BATCH" \
      --out "$OUT_COMMENT" \
      ${progress_note:+--progress "$progress_note"} \
      ${HDX_EVAL_RUN_URL:+--run-url "$HDX_EVAL_RUN_URL"} \
      ${HDX_EVAL_COMMIT_SHA:+--commit "$HDX_EVAL_COMMIT_SHA"} \
      >/dev/null 2>&1 || true
  fi
  if [ -n "${HDX_EVAL_GH_TOKEN:-}" ] && [ -n "${HDX_EVAL_GH_REPO:-}" ] \
    && [ -n "${HDX_EVAL_GH_PR:-}" ] && [ -f "$OUT_COMMENT" ]; then
    bash "$POST_SH" "$OUT_COMMENT" || echo "  (progressive comment post failed — continuing)"
  fi
}

echo "::group::[setup] Register account + Connection + Sources (all scenarios)"
"${CLI[@]}" setup-hyperdx \
  --api-url "$HDX_EVAL_API_URL" \
  --connection-ch-url "$CONNECTION_CH_URL"
echo "::endgroup::"

# Seed one scenario, honoring the Parquet snapshot fast path when configured.
seed_scenario() {
  local scenario="$1"
  if [ -n "$SNAPSHOT_DIR" ]; then
    local scen_snap_dir="$SNAPSHOT_DIR/$scenario"
    if [ -f "$scen_snap_dir/manifest.json" ]; then
      echo "Snapshot HIT → loading Parquet from $scen_snap_dir"
      "${CLI[@]}" load-snapshot "$scenario" --dir "$scen_snap_dir"
    else
      echo "Snapshot MISS → generating (factor $SNAPSHOT_VOLUME_FACTOR) then exporting Parquet"
      "${CLI[@]}" seed "$scenario" \
        --volume-factor "$SNAPSHOT_VOLUME_FACTOR" \
        --now "$ANCHOR"
      "${CLI[@]}" export-snapshot "$scenario" \
        --dir "$scen_snap_dir" \
        --volume-factor "$SNAPSHOT_VOLUME_FACTOR" \
        --anchor "$ANCHOR"
    fi
  else
    "${CLI[@]}" seed "$scenario" --volume-factor "$VOLUME_FACTOR" --now "$ANCHOR"
  fi
}

# Post an initial "queued" comment so reviewers see the suite is running.
render_and_post "starting — 0/$TOTAL scenarios complete"

idx=0
for scenario in "${SCENARIOS[@]}"; do
  scenario="$(echo "$scenario" | tr -d '[:space:]')"
  [ -z "$scenario" ] && continue
  idx=$((idx + 1))
  echo "::group::[$idx/$TOTAL] $scenario — seed"
  seed_scenario "$scenario"
  echo "::endgroup::"

  echo "::group::[$idx/$TOTAL] $scenario — run + grade"
  # Accumulate into the shared batch; grade inline so the progressive comment
  # shows real grades. Skip the per-scenario report — we render the aggregate
  # ourselves below (and once more at the very end).
  "${CLI[@]}" run "$scenario" \
    --mcp "$MCP" \
    --runs "$RUNS" \
    --max-turns "$MAX_TURNS" \
    --timeout "$TIMEOUT_MS" \
    --concurrency "$CONCURRENCY" \
    --anchor-time "$ANCHOR" \
    --batch "$BATCH" \
    --no-report
  echo "::endgroup::"

  # Free the ClickHouse tables for this scenario now that its runs are graded;
  # the snapshot on disk remains the durable copy.
  echo "::group::[$idx/$TOTAL] $scenario — drop tables"
  "${CLI[@]}" drop "$scenario" || echo "  (drop failed — continuing)"
  echo "::endgroup::"

  render_and_post "$idx/$TOTAL scenarios complete (just finished: $scenario)"
done

# ── Final report + verdict ─────────────────────────────────────────────────
echo "::group::[report] Aggregate suite verdict"
"${CLI[@]}" report "$BATCH"
mkdir -p "$(dirname "$OUT_COMMENT")"
render_and_post "complete — $TOTAL/$TOTAL scenarios"
echo "::endgroup::"

echo "Wrote verdict comment to $OUT_COMMENT"
echo "Batch: runs/$BATCH"
echo "Done."
