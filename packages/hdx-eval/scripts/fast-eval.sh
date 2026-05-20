#!/usr/bin/env bash
# fast-eval.sh — bulk seed all scenarios at a shared anchor, then run the
# eval in parallel across scenarios.
#
# Speedup vs the legacy sequential per-scenario re-seed:
#   - seed once, share across all (mcp, run) cells          (-50 min)
#   - run scenarios concurrently, agents in parallel        (variable)
#
# Usage:
#   ./packages/hdx-eval/scripts/fast-eval.sh
#       [SCENARIOS="error-root-cause latency-spike ..."]
#       [RUNS=2] [PER_SCENARIO_CONCURRENCY=2] [SCENARIO_CONCURRENCY=2]
#
# Reads ANTHROPIC_API_KEY from ~/.config/hdx-eval-anthropic-key.
# Assumes the dev API + ClickHouse are already up at the slot's ports.

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

SCENARIOS="${SCENARIOS:-error-root-cause latency-spike noisy-signals segmented-regression}"
RUNS="${RUNS:-2}"
PER_SCENARIO_CONCURRENCY="${PER_SCENARIO_CONCURRENCY:-2}"
SCENARIO_CONCURRENCY="${SCENARIO_CONCURRENCY:-2}"
# Anchor at "now" rounded to the nearest minute. All scenarios will seed at
# this same timestamp and the agent's system prompt will use it as "now".
ANCHOR_TIME="${ANCHOR_TIME:-$(date -u -d "$(date -u +%Y-%m-%dT%H:%M:00)" +%Y-%m-%dT%H:%M:%SZ)}"

OUT_DIR="$REPO_ROOT/packages/hdx-eval/ablation"
mkdir -p "$OUT_DIR"
LOGDIR="$OUT_DIR/fast-eval-$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$LOGDIR"

echo "=========================================================="
echo " fast-eval"
echo "   scenarios          : $SCENARIOS"
echo "   runs per cell      : $RUNS"
echo "   per-scenario conc  : $PER_SCENARIO_CONCURRENCY"
echo "   scenario conc      : $SCENARIO_CONCURRENCY"
echo "   anchor time        : $ANCHOR_TIME"
echo "   log dir            : $LOGDIR"
echo "=========================================================="

# ─── Phase 1: seed all scenarios at the shared anchor ─────────────────────
echo
echo "[$(date +%H:%M:%S)] Phase 1: seeding all scenarios at $ANCHOR_TIME (parallel)"
seed_pids=()
for scenario in $SCENARIOS; do
  (
    log="$LOGDIR/seed.$scenario.log"
    echo "  [$(date +%H:%M:%S)] start seed $scenario  → $log"
    yarn workspace @hyperdx/hdx-eval dev seed "$scenario" \
        --seed 42 --now "$ANCHOR_TIME" \
        --ch-url "http://localhost:${HDX_DEV_CH_HTTP_PORT}" \
        > "$log" 2>&1
    rc=$?
    echo "  [$(date +%H:%M:%S)] done  seed $scenario  exit=$rc"
  ) &
  seed_pids+=($!)
done
seed_failed=0
for pid in "${seed_pids[@]}"; do
  wait "$pid" || seed_failed=1
done
if (( seed_failed )); then
  echo "One or more seeds failed — see $LOGDIR/seed.*.log" >&2
  exit 1
fi

# ─── Phase 2: run scenarios in parallel, each cell pool also parallel ─────
echo
echo "[$(date +%H:%M:%S)] Phase 2: running scenarios (concurrency=$SCENARIO_CONCURRENCY × $PER_SCENARIO_CONCURRENCY agents/scenario)"

# Pool of scenario-runners. Limit to SCENARIO_CONCURRENCY in flight.
running=0
run_pids=()
run_scens=()
for scenario in $SCENARIOS; do
  while (( running >= SCENARIO_CONCURRENCY )); do
    # Wait for any one to finish.
    for idx in "${!run_pids[@]}"; do
      pid="${run_pids[$idx]}"
      if ! kill -0 "$pid" 2>/dev/null; then
        wait "$pid" || true
        unset 'run_pids[idx]'
        unset 'run_scens[idx]'
        running=$((running - 1))
      fi
    done
    sleep 1
  done
  (
    log="$LOGDIR/run.$scenario.log"
    echo "  [$(date +%H:%M:%S)] start run $scenario  → $log"
    yarn workspace @hyperdx/hdx-eval dev run "$scenario" \
        --runs "$RUNS" --mcp both --no-reseed \
        --anchor-time "$ANCHOR_TIME" \
        --concurrency "$PER_SCENARIO_CONCURRENCY" \
        --ch-url "http://localhost:${HDX_DEV_CH_HTTP_PORT}" \
        > "$log" 2>&1
    rc=$?
    batch=$(grep -oE 'runs/[^ ]+' "$log" | head -1)
    echo "  [$(date +%H:%M:%S)] done  run $scenario  exit=$rc batch=$batch"
  ) &
  run_pids+=($!)
  run_scens+=("$scenario")
  running=$((running + 1))
done
wait
echo
echo "[$(date +%H:%M:%S)] ALL DONE"
echo "Logs: $LOGDIR"
