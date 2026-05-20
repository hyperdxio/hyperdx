#!/usr/bin/env bash
# compare-prompt-variants.sh — A/B the baseline vs hypothesis system prompt
# on a fixed set of scenarios at a shared anchor.
#
# Runs N×scenarios×{baseline,hypothesis} agents against the already-seeded
# tables (no reseed), then grades the resulting batches.
#
# Usage:
#   ./packages/hdx-eval/scripts/compare-prompt-variants.sh
#       [SCENARIOS="latency-spike segmented-regression error-root-cause"]
#       [RUNS=3] [MCP=both] [PER_SCENARIO_CONCURRENCY=10]
#       [ANCHOR_TIME=2026-05-11T04:49:00Z]
#       [VARIANTS="baseline hypothesis"]
#
# Defaults tuned for fast iteration: n=3 per cell, 10 agents in parallel per
# (scenario, variant), grading parallelized across all batches. Override any
# of those env vars to revert to a slower / more thorough sweep.

set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
cd "$REPO_ROOT"

source ~/.nvm/nvm.sh > /dev/null 2>&1 || true
nvm use 22.21.1 > /dev/null 2>&1 || true
export PATH="/usr/local/bin:$HOME/.local/bin:$PATH"

if [[ ! -f "$HOME/.config/hdx-eval-anthropic-key" ]]; then
  echo "Missing ~/.config/hdx-eval-anthropic-key — aborting" >&2
  exit 1
fi
export ANTHROPIC_API_KEY=$(cat "$HOME/.config/hdx-eval-anthropic-key")

source ./scripts/dev-env.sh > /dev/null

SCENARIOS="${SCENARIOS:-latency-spike segmented-regression error-root-cause}"
RUNS="${RUNS:-3}"
MCP="${MCP:-both}"
MODEL="${MODEL:-claude-sonnet-4-6}"
PER_SCENARIO_CONCURRENCY="${PER_SCENARIO_CONCURRENCY:-5}"
ANCHOR_TIME="${ANCHOR_TIME:-2026-05-11T04:49:00Z}"
VARIANTS="${VARIANTS:-baseline hypothesis}"

OUT_DIR="$REPO_ROOT/packages/hdx-eval/ablation"
mkdir -p "$OUT_DIR"
LOGDIR="$OUT_DIR/prompt-variant-$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$LOGDIR"

echo "=========================================================="
echo " compare-prompt-variants"
echo "   scenarios          : $SCENARIOS"
echo "   variants           : $VARIANTS"
echo "   runs per cell      : $RUNS"
echo "   mcp                : $MCP"
echo "   per-scenario conc  : $PER_SCENARIO_CONCURRENCY"
echo "   anchor time        : $ANCHOR_TIME"
echo "   log dir            : $LOGDIR"
echo "=========================================================="

run_one_variant() {
  local variant="$1"
  echo
  echo "[$(date +%H:%M:%S)] === variant=$variant ==="
  pids=()
  for scenario in $SCENARIOS; do
    (
      log="$LOGDIR/run.$variant.$scenario.log"
      echo "  [$(date +%H:%M:%S)] start $variant/$scenario  → $log"
      yarn workspace @hyperdx/hdx-eval dev run "$scenario" \
          --runs "$RUNS" --mcp "$MCP" --no-reseed \
          --anchor-time "$ANCHOR_TIME" \
          --concurrency "$PER_SCENARIO_CONCURRENCY" \
          --prompt-variant "$variant" \
          --model "$MODEL" \
          --ch-url "http://localhost:${HDX_DEV_CH_HTTP_PORT}" \
          > "$log" 2>&1
      rc=$?
      batch=$(grep -oE 'runs/[^ ]+' "$log" | head -1)
      echo "  [$(date +%H:%M:%S)] done  $variant/$scenario  exit=$rc batch=$batch"
      if [[ -n "$batch" ]]; then
        echo "$variant $scenario $batch" >> "$LOGDIR/batches.tsv"
      fi
    ) &
    pids+=($!)
  done
  for pid in "${pids[@]}"; do
    wait "$pid" || true
  done
}

for v in $VARIANTS; do
  run_one_variant "$v"
done

echo
echo "[$(date +%H:%M:%S)] All runs done. Batches:"
cat "$LOGDIR/batches.tsv" 2>/dev/null || echo "  (no batches recorded)"

# ─── Grade each batch (in parallel) ────────────────────────────────────────
# Judge calls are independent per (run, scenario, mcp); fan them out instead
# of grinding through batches serially. With one batch per (variant, scenario)
# this is up to 6 concurrent grade invocations on the default 3-scenario
# × 2-variant sweep.
echo
echo "[$(date +%H:%M:%S)] Grading all batches (parallel)..."
grade_pids=()
while read -r variant scenario batch; do
  [[ -z "$batch" ]] && continue
  (
    log="$LOGDIR/grade.$variant.$scenario.log"
    echo "  [$(date +%H:%M:%S)] start grade $variant/$scenario  → $log"
    yarn workspace @hyperdx/hdx-eval dev grade "$batch" > "$log" 2>&1
    rc=$?
    echo "  [$(date +%H:%M:%S)] done  grade $variant/$scenario  exit=$rc"
  ) &
  grade_pids+=($!)
done < "$LOGDIR/batches.tsv"
for pid in "${grade_pids[@]}"; do
  wait "$pid" || true
done

echo
echo "[$(date +%H:%M:%S)] ALL DONE"
echo "Logs: $LOGDIR"
echo "Batches: $LOGDIR/batches.tsv"
