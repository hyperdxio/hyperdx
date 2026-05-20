#!/usr/bin/env bash
# Ablation runner for the MCP query-tool experiments.
#
# Variants:
#   baseline — current MCP (hyperdx_query, JSON)
#   split    — HDX_MCP_SPLIT_QUERY=1 (hyperdx_timeseries / table / search / sql)
#   toon     — HDX_MCP_OUTPUT=toon (TOON output, ClickHouse metadata stripped)
#   both     — split + toon
#
# Per variant: kill the running API process, restart yarn app:dev with the
# variant env vars, wait for /health, run hdx-eval (HDX MCP only) on every
# scenario at n=$RUNS, and stash the resulting batch dirs under
# ablation/<variant>/<scenario>.
#
# Reads ANTHROPIC_API_KEY from ~/.config/hdx-eval-anthropic-key.

set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
cd "$REPO_ROOT"

VARIANTS="${VARIANTS:-baseline split toon both}"
SCENARIOS="${SCENARIOS:-error-root-cause latency-spike noisy-signals}"
RUNS="${RUNS:-2}"

OUT_DIR="$REPO_ROOT/packages/hdx-eval/ablation"
mkdir -p "$OUT_DIR"
MANIFEST="$OUT_DIR/manifest.tsv"
echo -e "variant\tscenario\tbatchDir\tstartedAt" > "$MANIFEST"

source ~/.nvm/nvm.sh > /dev/null 2>&1 || true
nvm use 22.21.1 > /dev/null 2>&1 || true
export PATH="/usr/local/bin:$HOME/.local/bin:$PATH"

if [[ ! -f "$HOME/.config/hdx-eval-anthropic-key" ]]; then
  echo "Missing ~/.config/hdx-eval-anthropic-key — aborting" >&2
  exit 1
fi
export ANTHROPIC_API_KEY=$(cat "$HOME/.config/hdx-eval-anthropic-key")

# ─── dev-env (port slot, etc) ──────────────────────────────────────────────
source ./scripts/dev-env.sh > /dev/null

# ─── ensure docker stack is up (idempotent) ────────────────────────────────
# We bypass `yarn dev` because that script runs `docker compose down` when
# yarn app:dev exits, which would tear down ClickHouse between variants.
# Bring docker up once here; leave it running across variants.
ensure_docker() {
  echo "[$(date +%H:%M:%S)] Ensuring docker stack is up (project=$HDX_DEV_PROJECT)..."
  sg docker -c "docker compose -p '$HDX_DEV_PROJECT' -f docker-compose.dev.yml up -d" \
    > "$OUT_DIR/_docker.log" 2>&1
}
ensure_docker

# ─── env-vars per variant ──────────────────────────────────────────────────
variant_env() {
  case "$1" in
    baseline) echo "" ;;
    split)    echo "HDX_MCP_SPLIT_QUERY=1" ;;
    toon)     echo "HDX_MCP_OUTPUT=toon" ;;
    both)     echo "HDX_MCP_SPLIT_QUERY=1 HDX_MCP_OUTPUT=toon" ;;
    *)        echo "unknown variant: $1" >&2; exit 1 ;;
  esac
}

# ─── kill the API process group ────────────────────────────────────────────
# We start the API in its own process group via setsid so we can kill the
# whole tree (yarn → nodemon → ts-node) with `kill -- -<pgid>`. Falling back
# to pattern-pkill in case the pgid isn't tracked (first invocation).
API_PGID_FILE="$OUT_DIR/_api.pgid"

kill_api() {
  echo "[$(date +%H:%M:%S)] Killing existing API processes..."
  if [[ -f "$API_PGID_FILE" ]]; then
    local pgid
    pgid="$(cat "$API_PGID_FILE")"
    if [[ -n "$pgid" ]] && kill -0 "-$pgid" 2>/dev/null; then
      kill -TERM -- "-$pgid" 2>/dev/null || true
      sleep 3
      kill -KILL -- "-$pgid" 2>/dev/null || true
    fi
    rm -f "$API_PGID_FILE"
  fi
  # Best-effort cleanup of anything that survived.
  pkill -9 -f 'nodemon.*src/index'  >/dev/null 2>&1 || true
  pkill -9 -f 'ts-node.*src/index'  >/dev/null 2>&1 || true
  # Wait until the API port is actually free before returning.
  for _ in {1..15}; do
    if ! ss -tln 2>/dev/null | grep -q ":${HYPERDX_API_PORT}\b"; then
      break
    fi
    sleep 1
  done
  ensure_docker
}

# ─── start ONLY the @hyperdx/api workspace dev process ─────────────────────
# We bypass yarn app:dev (which also brings up Next.js, the alerts-task, and
# a common-utils nodemon — none of which the eval needs). Just
# `yarn workspace @hyperdx/api dev` is enough to host /mcp.
#
# Started via `setsid` so the process gets its own group; pgid is recorded so
# kill_api can take down the whole tree at once.
start_api() {
  local env_extra="$1"
  local label="$2"
  local logfile="$OUT_DIR/$label.api.log"
  echo "[$(date +%H:%M:%S)] Starting API with: $env_extra"
  setsid bash -c "source ~/.nvm/nvm.sh && nvm use 22.21.1 > /dev/null && source ./scripts/dev-env.sh && export $env_extra && yarn workspace @hyperdx/api dev" \
    > "$logfile" 2>&1 &
  local pid=$!
  echo "$pid" > "$API_PGID_FILE"  # setsid makes pid == pgid
  echo "  pgid=$pid log=$logfile"
}

wait_for_api() {
  echo -n "  Waiting for API"
  local deadline=$(( $(date +%s) + 240 ))
  while (( $(date +%s) < deadline )); do
    if curl -fsS "http://localhost:${HYPERDX_API_PORT}/health" > /dev/null 2>&1; then
      echo " — ready"
      return 0
    fi
    echo -n "."
    sleep 3
  done
  echo " — TIMEOUT"
  return 1
}

# ─── per-scenario eval invocation ──────────────────────────────────────────
run_variant() {
  local variant="$1"
  local env_extra
  env_extra="$(variant_env "$variant")"
  local started
  started="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

  echo
  echo "=========================================================="
  echo " VARIANT: $variant   ($started)"
  echo "=========================================================="

  kill_api
  start_api "$env_extra" "$variant"
  if ! wait_for_api; then
    echo "API failed to start for variant=$variant; skipping" >&2
    return 1
  fi

  for scenario in $SCENARIOS; do
    echo "[$(date +%H:%M:%S)] $variant / $scenario — running n=$RUNS..."
    local logfile="$OUT_DIR/$variant.$scenario.run.log"
    yarn workspace @hyperdx/hdx-eval dev run "$scenario" \
        --runs "$RUNS" \
        --mcp hyperdx \
        > "$logfile" 2>&1
    local rc=$?
    local batch_dir
    batch_dir="$(grep -oE 'runs/[0-9TZ:.-]+' "$logfile" | head -1)"
    echo -e "${variant}\t${scenario}\t${batch_dir}\t${started}" >> "$MANIFEST"
    echo "    -> rc=$rc batch=$batch_dir"
  done
}

# ─── main ──────────────────────────────────────────────────────────────────
echo "Repo: $REPO_ROOT"
echo "Variants: $VARIANTS"
echo "Scenarios: $SCENARIOS"
echo "Runs/cell: $RUNS"
echo "Manifest: $MANIFEST"

for variant in $VARIANTS; do
  run_variant "$variant"
done

echo
echo "All variants done at $(date +%H:%M:%S). Manifest:"
cat "$MANIFEST"
