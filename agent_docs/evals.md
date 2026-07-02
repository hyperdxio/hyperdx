# MCP Eval Framework

Read this before running evals, comparing MCP branches, or investigating eval
results. For the full CLI reference, config schema, scenario details, and
scoring formula, see [`packages/hdx-eval/README.md`](../packages/hdx-eval/README.md).

## What It Does

The eval framework spawns Claude Code as an SRE agent, gives it access to an
MCP server, and asks it to solve observability scenarios (find a root cause,
build a dashboard, etc.) against synthetic telemetry seeded into ClickHouse.
Answers are graded with programmatic regex checks (40%) + an LLM judge (60%),
minus a penalty for tool-call errors. The framework is MCP-agnostic — you can
compare any two (or more) MCP servers side by side.

### Available scenarios

| Scenario | Type | What It Tests |
|---|---|---|
| `error-root-cause` | Investigation | Find a cascading DB timeout causing checkout failures |
| `latency-spike` | Investigation | Identify a segmented p99 spike for enterprise tenants |
| `noisy-signals` | Investigation | Find load-bearing log patterns among noise |
| `segmented-regression` | Investigation | Detect a regression hidden by single-axis aggregation |
| `service-health-check` | Investigation | Generate a peace-time health report |
| `dashboard-build` | Dashboard creation | Build monitoring dashboards with diverse tile types |

## Prerequisites

| Requirement | Notes |
|---|---|
| `yarn dev` running | Each worktree needs `yarn dev` running with a fixed slot. This handles `yarn install`, `yarn build:common-utils`, Docker containers (ClickHouse, MongoDB), and the API server. See [Development Setup](development.md). |
| `ANTHROPIC_API_KEY` or `AI_API_KEY` | Auto-loaded from `.env.local` at the monorepo root. Check `.env.local` in other worktrees for existing keys if missing. |
| `claude` CLI | Installed globally (`which claude`). The harness spawns it in streaming JSON mode. |
| `uv` | Only needed for `stdio`-type MCPs (e.g. raw ClickHouse MCP). Install via `curl -LsSf https://astral.sh/uv/install.sh \| sh`. |
| Two git worktrees | One checked out to the branch under test, one to `main`. Use `git worktree list` to verify. |

## Dual-Slot A/B Comparison (Primary Workflow)

This is the standard workflow for comparing a feature branch against main.

### Architecture

Evals run from **one worktree** (the branch being tested). The eval harness
talks to **two separate HyperDX API instances** running on different slots:

```
                        ┌──────────────────────┐
                        │   Eval Harness       │
                        │   (this worktree)    │
                        │                      │
                        │  eval.config.json    │
                        │  ┌────────┬────────┐ │
                        │  │branch  │ main   │ │
                        │  │MCP     │ MCP    │ │
                        │  └───┬────┴───┬────┘ │
                        └──────┼────────┼──────┘
                               │        │
              ┌────────────────┘        └────────────────┐
              ▼                                          ▼
   ┌─────────────────────┐                  ┌─────────────────────┐
   │  Slot 98 (branch)   │                  │  Slot 99 (main)     │
   │  API  :30198        │                  │  API  :30199        │
   │  CH   :30598        │                  │  CH   :30599        │
   │  Mongo:30498        │                  │  Mongo:30499        │
   │  MCP  :30198/mcp    │                  │  MCP  :30199/mcp    │
   └─────────────────────┘                  └─────────────────────┘
       branch worktree                          main worktree
```

Each slot runs its own ClickHouse instance. Eval data (synthetic traces/logs)
must be seeded into **both** ClickHouse instances separately — the harness
auto-seeds on first run per slot, but only into the ClickHouse that the active
`eval.config.json` points at. See step 2 below for how `setup-hyperdx` targets
each instance.

### 1. Start both dev stacks

`yarn dev` starts Docker infra (ClickHouse, MongoDB, OTel Collector) **and**
the API + App servers in one command. Run it from each worktree with a fixed
slot:

```bash
# From the branch worktree (slot 98)
HDX_DEV_SLOT=98 yarn dev

# From the main worktree (slot 99)
HDX_DEV_SLOT=99 yarn dev
```

Each command prints a banner with its port assignments. Wait for both to
finish starting, then verify:

```bash
curl -s -o /dev/null -w "Slot 98 API: %{http_code}\n" http://localhost:30198/api/v1/me
curl -s -o /dev/null -w "Slot 99 API: %{http_code}\n" http://localhost:30199/api/v1/me
# Expected: 404 (no auth token — but the server is responding)

curl -s -o /dev/null -w "Slot 98 CH: %{http_code}\n" http://localhost:30598/
curl -s -o /dev/null -w "Slot 99 CH: %{http_code}\n" http://localhost:30599/
# Expected: 200
```

### 2. Run `setup-hyperdx` against each instance (if needed)

> Run these commands from the worktree that has the eval framework code (the
> branch under test).

This registers an eval account, creates a ClickHouse Connection, and creates
per-scenario Sources on each HyperDX instance. The command is **idempotent** —
it skips anything that already exists, so it's safe to run every time.

**Skip this step** if `eval.config.branch.json` and `eval.config.main.json`
already exist and pass the check:

```bash
# Quick check: do saved configs exist and are the MCPs reachable?
# NOTE: These cp commands temporarily overwrite eval.config.json with a
# single-instance config. If you already have a combined two-MCP config,
# you must re-run step 3 (jq merge) afterward.
cp packages/hdx-eval/eval.config.branch.json packages/hdx-eval/eval.config.json 2>/dev/null && \
  yarn workspace @hyperdx/hdx-eval dev setup-hyperdx --check && \
  echo "Branch config OK" || echo "Branch config needs setup"

cp packages/hdx-eval/eval.config.main.json packages/hdx-eval/eval.config.json 2>/dev/null && \
  yarn workspace @hyperdx/hdx-eval dev setup-hyperdx --check && \
  echo "Main config OK" || echo "Main config needs setup"
```

If either needs setup (or this is the first time):

```bash
# Setup branch instance
yarn workspace @hyperdx/hdx-eval dev setup-hyperdx --api-url http://localhost:30198
cp packages/hdx-eval/eval.config.json packages/hdx-eval/eval.config.branch.json

# Setup main instance
yarn workspace @hyperdx/hdx-eval dev setup-hyperdx --api-url http://localhost:30199
cp packages/hdx-eval/eval.config.json packages/hdx-eval/eval.config.main.json
```

### 3. Build the combined eval config

The eval runner needs a single `eval.config.json` with both MCPs so it can
compare them in one batch. Use `jq` to merge:

```bash
cat packages/hdx-eval/eval.config.branch.json | jq \
  --slurpfile main packages/hdx-eval/eval.config.main.json '
  . as $branch |
  .mcps = {
    "hyperdx-branch": ($branch.mcps.hyperdx + {"label": "HyperDX Branch", "enabled": true}),
    "hyperdx-main": ($main[0].mcps.hyperdx + {"label": "HyperDX Main", "enabled": true})
  } |
  .hyperdxApi = $branch.hyperdxApi
' > packages/hdx-eval/eval.config.json
```

Verify the config has both MCPs:

```bash
jq '.mcps | keys' packages/hdx-eval/eval.config.json
# Expected: ["hyperdx-branch", "hyperdx-main"]
```

### 4. Verify MCP connectivity

```bash
BRANCH_KEY=$(jq -r '.hyperdxApi.accessKey' packages/hdx-eval/eval.config.branch.json)
MAIN_KEY=$(jq -r '.mcps["hyperdx-main"].headers.Authorization' packages/hdx-eval/eval.config.json | sed 's/Bearer //')
curl -s -o /dev/null -w "Branch MCP: %{http_code}\n" \
  -H "Authorization: Bearer $BRANCH_KEY" http://localhost:30198/mcp
curl -s -o /dev/null -w "Main MCP: %{http_code}\n" \
  -H "Authorization: Bearer $MAIN_KEY" http://localhost:30199/mcp
# Expected: 406 (SSE endpoint, wrong HTTP method — but proves auth works)
```

### 5. Run the comparison

```bash
yarn workspace @hyperdx/hdx-eval dev run <scenario> \
  --mcp hyperdx-branch,hyperdx-main \
  --baseline hyperdx-main \
  --runs 3 \
  --max-turns 15 \
  --timeout 600000 \
  --judge-model claude-opus-4-7
```

The eval harness automatically loads `ANTHROPIC_API_KEY` (or `AI_API_KEY`)
from `.env.local` at the monorepo root via `dotenvx`. If the key isn't there,
either add it to `.env.local` or export it in your shell. Check `.env.local`
files in other worktrees or `~/sites/hyperdx/.env.local` for existing keys.

The eval harness auto-seeds data on first run if the scenario tables are empty.
Subsequent runs reuse existing data and the saved anchor time.

### Recommended flags

| Flag | Recommended Value | Why |
|---|---|---|
| `--timeout` | `600000` (10 min) | The default 5 min causes false timeouts on complex scenarios like `dashboard-build`. |
| `--concurrency` | omit (default 1) | Concurrent runs cause resource contention and false timeouts. Run sequentially. |
| `--runs` | `3` minimum | Eval results have high variance. 3 runs is the minimum for meaningful comparison. |
| `--baseline` | `hyperdx-main` | Sets main as the reference for delta computation in reports. |
| `--judge-model` | `claude-opus-4-7` | Default. Use a strong model for judging. |
| `--no-judge` | use for fast iteration | Skips the LLM judge (saves cost/time). Programmatic scores only. |

## Other Use Cases

The dual-slot A/B comparison is the primary workflow, but the eval framework
supports other configurations with a single dev stack.

### Quick score check (single MCP)

Run one MCP against a scenario to get a baseline score without comparison.
Useful for validating that a scenario works or checking score after a change.

```bash
# Single slot — just one `yarn dev` needed
export HDX_DEV_SLOT=98
yarn workspace @hyperdx/hdx-eval dev setup-hyperdx
yarn workspace @hyperdx/hdx-eval dev run error-root-cause --mcp hyperdx --runs 1 --no-judge
```

### Model comparison (same MCP, different models)

Compare how different models perform on the same MCP and data. Useful for
evaluating model upgrades or cost/quality tradeoffs.

```bash
yarn workspace @hyperdx/hdx-eval dev run error-root-cause \
  --mcp hyperdx --model claude-sonnet-4-20250514 --runs 3
yarn workspace @hyperdx/hdx-eval dev run error-root-cause \
  --mcp hyperdx --model claude-opus-4-6 --runs 3
```

### Non-HyperDX MCP (e.g. raw ClickHouse)

The framework works with any MCP. The `clickhouse` stdio MCP is included by
default in `eval.config.json` after setup. Use it to compare HyperDX's MCP
against querying ClickHouse directly.

```bash
yarn workspace @hyperdx/hdx-eval dev run error-root-cause \
  --mcp hyperdx,clickhouse --baseline clickhouse --runs 3
```

## Reading Results

Results are written to `packages/hdx-eval/runs/<batch-timestamp>/`. Each batch
contains:

```
_summary.md              # Markdown comparison report
_summary.json            # Structured data for programmatic use
<scenario>/
  <mcp>/
    <model>/
      0.json             # Full run trajectory (tool calls, tokens, timing)
      0.grade.json       # Grade record (programmatic + judge scores)
```

Useful inspection commands:

```bash
# List all batches
yarn workspace @hyperdx/hdx-eval dev runs-list

# Show a specific run's tool calls and queries
yarn workspace @hyperdx/hdx-eval dev runs-show <path> --queries

# Show the agent's final answer
yarn workspace @hyperdx/hdx-eval dev runs-show <path> --final-answer

# Re-grade with only programmatic checks (fast, no API key needed)
yarn workspace @hyperdx/hdx-eval dev grade <batch> --no-judge

# Re-generate the comparison report with a different baseline
yarn workspace @hyperdx/hdx-eval dev report <batch> --baseline hyperdx-main

# Browse results in the web viewer
yarn workspace @hyperdx/hdx-eval viewer
```

## Common Pitfalls

### Containers bind to wrong ports

If you run `docker compose up` without sourcing `scripts/dev-env.sh` first,
containers bind to default ports (8123, 27017) instead of slot-specific ones.
Always use the `bash -c 'export HDX_DEV_SLOT=... && source scripts/dev-env.sh
&& docker compose ...'` pattern (see [Cleanup](#cleanup) below).

### Access keys go stale after container restarts

When MongoDB is recreated, the eval account's access key changes. Re-run
`setup-hyperdx` against the affected instance and rebuild the combined config.

### False timeouts

Two common causes:
1. **Default 5-minute timeout is too short** for complex scenarios. Use
   `--timeout 600000` (10 minutes).
2. **`--concurrency > 1`** causes resource contention between parallel Claude
   processes. Run sequentially (omit `--concurrency`).

### `eval.config.json` is gitignored

The eval config files (`eval.config.json`, `eval.config.*.json`) are
gitignored because they contain instance-specific access keys and Source IDs.
They must be regenerated per environment using `setup-hyperdx`.

### ClickHouse data missing after container recreation

If Docker volumes are removed (e.g. `docker compose down -v`), seeded data is
lost. The eval harness auto-seeds on the next run if it detects empty tables,
but this adds time. Use `--reseed` explicitly to force a fresh seed.

### Dev stack not starting

If `yarn dev` fails:
- Port already in use — another stack on the same slot is running. Check with
  `lsof -i :301XX` and kill stale processes.
- Docker not running — start Docker Desktop or OrbStack first.
- Missing dependencies — run `yarn setup` from the repo root.

## Cleanup

```bash
# If you started with `yarn dev`, Ctrl-C in each terminal stops everything.
# If you started Docker separately:
bash -c 'export HDX_DEV_SLOT=98 && source scripts/dev-env.sh 2>/dev/null && \
  docker compose -p hdx-dev-98 -f docker-compose.dev.yml down'
bash -c 'export HDX_DEV_SLOT=99 && source scripts/dev-env.sh 2>/dev/null && \
  docker compose -p hdx-dev-99 -f docker-compose.dev.yml down'

# Drop eval data from ClickHouse (optional)
yarn workspace @hyperdx/hdx-eval dev drop <scenario>
```
