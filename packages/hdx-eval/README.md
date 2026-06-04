# @hyperdx/hdx-eval

Eval framework for benchmarking AI agents against observability MCP servers.
Generates deterministic synthetic telemetry (traces + logs) with planted
anomalies, spawns Claude Code as an SRE agent with access to any configured
MCP, records full trajectories, and grades answers using programmatic checks and
an LLM-as-judge. The framework is **MCP-agnostic** — compare any combination of
MCPs: HyperDX vs ClickHouse, feature-branch vs main, two different HyperDX
instances, or any N-way comparison. MCPs are defined in a config registry and
selected at run time.

## Prerequisites

- **`yarn dev` running** on at least one worktree (ClickHouse, MongoDB, API)
- **`claude` CLI installed** (the harness spawns it in streaming JSON mode)
- **`ANTHROPIC_API_KEY`** or **`AI_API_KEY`** in `.env.local` (for `run` and
  `grade` commands)
- **[`uv`](https://docs.astral.sh/uv/)** installed (only needed if you
  configure a `stdio`-type ClickHouse MCP — it launches via
  `uv run --with mcp-clickhouse`)

## Quick Start

```bash
# 1. One-time setup: register eval account + create Sources + write config
yarn workspace @hyperdx/hdx-eval dev setup-hyperdx

# 2. Seed a scenario (use --volume-factor 0.1 for faster iteration)
yarn workspace @hyperdx/hdx-eval dev seed error-root-cause --volume-factor 0.1

# 3. Run the eval (all enabled MCPs, 3 runs each)
#    First run saves an anchorTime to eval.config.json automatically.
yarn workspace @hyperdx/hdx-eval dev run error-root-cause

# 4. Re-run later — reuses saved anchor, skips reseed
yarn workspace @hyperdx/hdx-eval dev run error-root-cause

# 5. Grade + report (auto-runs after step 3 by default)
yarn workspace @hyperdx/hdx-eval dev grade <batch>
yarn workspace @hyperdx/hdx-eval dev report <batch>

# 6. Browse results in the web viewer
yarn workspace @hyperdx/hdx-eval viewer
```

## Recommended: Dual-Slot Eval Setup

For reliable A/B comparison of two HyperDX branches (e.g. feature vs main),
we recommend reserving two fixed dev slots. This gives you two fully isolated
HyperDX stacks (separate ClickHouse, MongoDB, API) that can run
simultaneously.

### 1. Start two dev stacks with fixed slots

```bash
# Slot 98: "baseline" — run from your main branch checkout
HDX_DEV_SLOT=98 yarn dev

# Slot 99: "candidate" — run from your feature branch checkout
HDX_DEV_SLOT=99 yarn dev
```

This gives you:

| | Slot 98 (baseline) | Slot 99 (candidate) |
|---|---|---|
| API | `http://localhost:30198` | `http://localhost:30199` |
| App | `http://localhost:30298` | `http://localhost:30299` |
| ClickHouse | `http://localhost:30598` | `http://localhost:30599` |
| MCP | `http://localhost:30198/mcp` | `http://localhost:30199/mcp` |

### 2. Run `setup-hyperdx` against each instance

```bash
# Setup baseline (slot 98)
yarn workspace @hyperdx/hdx-eval dev setup-hyperdx --api-url http://localhost:30198

# Setup candidate (slot 99)
yarn workspace @hyperdx/hdx-eval dev setup-hyperdx --api-url http://localhost:30199
```

After setup, `eval.config.json` will have the `hyperdx` MCP pointing at the
slot it was set up against. You can then manually add the second MCP entry
(see [MCP Configuration](#mcp-configuration) below).

### 3. Seed both ClickHouse instances

Both instances need the eval data:

```bash
yarn workspace @hyperdx/hdx-eval dev seed error-root-cause --ch-url http://localhost:30598
yarn workspace @hyperdx/hdx-eval dev seed error-root-cause --ch-url http://localhost:30599
```

### 4. Run the comparison

```bash
yarn workspace @hyperdx/hdx-eval dev run error-root-cause \
  --mcp hyperdx-main,hyperdx-feature \
  --baseline hyperdx-main \
  --runs 5
```

## MCP Configuration

MCPs are defined in `eval.config.json` under the `mcps` key. Each entry
fully specifies how to connect, which tools to allow/deny, and how to
anonymize the MCP identity for fair LLM judging.

### Config structure

```json
{
  "mcps": {
    "<name>": {
      "type": "http" | "stdio",
      "url": "...",                    // http only
      "headers": { ... },             // http only
      "command": "...",               // stdio only
      "args": ["..."],               // stdio only
      "env": { ... },                // stdio only
      "toolPattern": "mcp__<name>__*",
      "label": "Display Name",
      "brandTerms": ["Brand", "brand"],
      "deniedTools": ["mcp__<name>__tool_to_hide"],
      "enabled": true
    }
  },
  "scenarios": { ... },
  "hyperdxApi": { ... },
  "clickhouse": { ... }
}
```

### Field reference

| Field | Required | Description |
|---|---|---|
| `type` | yes | `"http"` for HTTP/SSE transport, `"stdio"` for subprocess |
| `url` | http | MCP server URL |
| `headers` | no | HTTP headers (e.g. `Authorization: Bearer ...`) |
| `command` | stdio | Executable to spawn |
| `args` | no | Command arguments |
| `env` | no | Environment variables for the subprocess |
| `toolPattern` | yes | Glob for allowed tools (e.g. `mcp__myname__*`) |
| `label` | yes | Human-readable name for reports |
| `brandTerms` | no | Terms to redact when blinding answers for the LLM judge |
| `deniedTools` | no | Tool names to deny (reduces tool count for faster schema loading) |
| `enabled` | no | `false` to exclude from `--mcp all` (default: `true`). Can still be explicitly named with `--mcp name`. |

### Top-level config sections

| Section | Required | Purpose |
|---|---|---|
| `mcps` | yes | MCP registry (see above) |
| `scenarios` | no | Per-scenario HyperDX Source IDs (populated by `setup-hyperdx`) |
| `hyperdxApi` | no | HyperDX API URL + access key (used only by `setup-hyperdx`) |
| `clickhouse` | no | ClickHouse connection for `seed`, `drop`, `runs-instrument` commands |
| `anchorTime` | no | Fixed "now" anchor (ISO 8601). Auto-generated and saved on first `run`. See [Anchor Time](#anchor-time). |

### Example: HTTP MCP (HyperDX)

```json
{
  "type": "http",
  "url": "http://localhost:30198/mcp",
  "headers": { "Authorization": "Bearer <access-key>" },
  "toolPattern": "mcp__hyperdx__*",
  "label": "HyperDX",
  "brandTerms": ["HyperDX", "hyperdx"],
  "deniedTools": [
    "mcp__hyperdx__hyperdx_delete_dashboard",
    "mcp__hyperdx__hyperdx_get_dashboard"
  ]
}
```

### Example: stdio MCP (raw ClickHouse)

```json
{
  "type": "stdio",
  "command": "uv",
  "args": ["run", "--with", "mcp-clickhouse==0.3.0", "--python", "3.10", "mcp-clickhouse"],
  "env": {
    "CLICKHOUSE_HOST": "localhost",
    "CLICKHOUSE_PORT": "30598",
    "CLICKHOUSE_USER": "default",
    "CLICKHOUSE_PASSWORD": ""
  },
  "toolPattern": "mcp__clickhouse__*",
  "label": "ClickHouse MCP",
  "brandTerms": ["ClickHouse MCP", "clickhouse"]
}
```

## Scenarios

Each scenario writes into its own ClickHouse tables
(`eval_<scenario>_otel_traces` / `eval_<scenario>_otel_logs`) whose schema
mirrors HyperDX's `otel_traces` / `otel_logs` exactly.

| Scenario | Agent Prompt | What's Planted |
|---|---|---|
| `error-root-cause` | "Checkout requests are failing..." | `payment-service` DB timeout cascading into `checkout-api` 5xx. 6M+ spans, 12M logs, 5 distractors. |
| `latency-spike` | "p99 latency on api-server has jumped..." | `/api/orders/search` p99 spike for enterprise tenants. 12M+ spans, 5 regions, 5 distractors. |
| `noisy-signals` | "We want to cut log ingest cost..." | ~16M logs across composite cells. Each noisy cell has a load-bearing pattern mixed in. |
| `segmented-regression` | "API error rate has gone up..." | Enterprise x cache-miss errors at ~12%. Single-axis aggregates dilute the signal. |
| `service-health-check` | "Generate a service health report..." | Peace-time report — no incident, but 4 novel signals to call out. |

Use `--volume-factor` to scale background row counts for faster iteration.
Planted anomaly counts stay fixed.

```bash
# Full volume (default) — realistic needle-in-haystack difficulty
yarn workspace @hyperdx/hdx-eval dev seed error-root-cause

# 10% volume — much faster, still structurally valid
yarn workspace @hyperdx/hdx-eval dev seed error-root-cause --volume-factor 0.1
```

## CLI Reference

All commands are run via `yarn workspace @hyperdx/hdx-eval dev <command>`.

### Setup

```bash
dev setup-hyperdx                           # one-time: register + create Sources
dev setup-hyperdx --api-url http://...      # explicit API URL
dev setup-hyperdx --check                   # validate existing config
dev setup-hyperdx --reset-sources           # recreate all Sources
```

### Data Management

```bash
dev list                                    # list scenarios + tables
dev seed <scenario>                         # seed with defaults (seed=42, now=Date.now())
dev seed <scenario> --seed 7                # custom PRNG seed
dev seed <scenario> --now 2026-05-08T15:00:00Z  # fixed anchor time
dev seed <scenario> --volume-factor 0.1     # 10% background volume
dev seed <scenario> --ch-url http://localhost:30599  # target specific CH
dev drop <scenario>                         # drop scenario tables
```

### Running Evals

```bash
dev run <scenario>                          # all enabled MCPs, 3 runs each
dev run <scenario> --mcp hyperdx            # single MCP
dev run <scenario> --mcp hyperdx-main,hyperdx-feature  # compare two
dev run <scenario> --mcp all                # all enabled MCPs (default)
dev run <scenario> --baseline hyperdx-main  # set baseline for delta reports
dev run <scenario> --runs 5                 # 5 runs per cell
dev run <scenario> --model claude-opus-4-6
dev run <scenario> --max-turns 20           # default: 15
dev run <scenario> --concurrency 4          # parallel cells
dev run <scenario> --prompt-variant hypothesis  # hypothesis-first variant
dev run <scenario> --reseed                 # re-seed data before running
dev run <scenario> --anchor-time 2026-05-08T15:00:00Z  # override + save anchor
dev run <scenario> --live                   # wall-clock now, no anchor, forces reseed
dev run <scenario> --no-grade               # skip auto-grading
dev run <scenario> --no-judge               # programmatic checks only (faster)
```

### Inspecting Results

```bash
dev runs-list                               # list recorded batches
dev runs-show <path>                        # summary of a run
dev runs-show <path> --queries              # every tool call + SQL
dev runs-show <path> --final-answer         # print the agent's answer
dev runs-instrument <batch>                 # enrich with ClickHouse query_log timings
```

### Grading & Reporting

```bash
dev grade <batch>                           # programmatic + LLM-as-judge
dev grade <batch> --judge-model claude-sonnet-4-6
dev grade <batch> --no-judge                # programmatic checks only
dev grade <batch> --rerun-judge             # re-run judge even if grades exist
dev report <batch>                          # render _summary.md + _summary.json
dev report <batch> --baseline hyperdx-main  # override baseline for deltas
```

### Viewer

```bash
yarn workspace @hyperdx/hdx-eval viewer    # web UI at http://localhost:5176
```

The viewer shows a **comparison dashboard** when you select a batch:

- **Top-line verdict table** — combined scores per MCP with delta columns
- **Per-scenario breakdown** — metrics, judge criterion heatmap, programmatic
  check pass rates
- **Side-by-side runs** — click any run to drill into the full trajectory

## Scoring

Combined score = `0.4 * programmatic + 0.6 * judge - toolErrorPenalty`

- **Programmatic (40%)** — regex-based keyword checks against the final
  answer, defined per-scenario in `ground-truth.json`. Includes both positive
  checks (must find the right thing) and negative checks (must not blame a
  distractor).
- **LLM-as-judge (60%)** — multi-criteria rubric scored 0-5 by Claude Opus
  (configurable). Criteria are scenario-specific. Answers are **blinded** —
  MCP tool names and brand terms are redacted so the judge can't tell which
  MCP produced the answer.
- **Tool error penalty** — up to 20% deducted for high tool-call error rates.

### Baseline + Challengers

Reports use a **baseline + challengers** model. One MCP is designated as the
baseline (default: first MCP alphabetically, or set explicitly with
`--baseline`). All other MCPs show deltas relative to it:

```
| Metric         | hyperdx-main | hyperdx-feature | Δ (hyperdx-feature) |
|----------------|-------------|-----------------|---------------------|
| Combined score | 85%         | 91%             | +6%                 |
```

## Determinism

All randomness flows through a `mulberry32(seed)` PRNG. Same `(seed, now)`
produces byte-identical row content. This makes side-by-side comparison
meaningful — both MCPs query the exact same data.

### Anchor Time

The anchor time is the "now" reference for both seeded data timestamps and
the agent's system prompt. It is persisted in `eval.config.json` under
`anchorTime` so that subsequent runs automatically reuse the same value.

- **First run**: if `anchorTime` is not set in the config, the current
  wall-clock time is saved and used.
- **Subsequent runs**: the saved `anchorTime` is read from config. No
  re-seed is needed — the data already matches.
- **`--anchor-time <iso>`**: override the saved value with a specific
  timestamp. The new value is saved to config for future runs. Pair with
  `--reseed` if the data needs to be regenerated to match.
- **`--live`**: ignore the saved anchor and use wall-clock time. The agent
  does NOT receive a `FIXED CURRENT TIME` system prompt block. Implies
  `--reseed` since the data must match the current time.

By default, `run` skips re-seeding (equivalent to the old `--no-reseed`).
Pass `--reseed` explicitly when you need to regenerate data (e.g. after
changing the seed or anchor time).

## Tests

```bash
yarn workspace @hyperdx/hdx-eval ci:unit   # all unit tests
yarn workspace @hyperdx/hdx-eval dev:unit  # watch mode
```

Unit tests verify PRNG determinism, planted anomaly invariants, grading
pipeline, stream parsing, prompt construction, blinding, and report
aggregation. No ClickHouse needed.
