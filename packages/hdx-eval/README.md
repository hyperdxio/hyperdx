# @hyperdx/hdx-eval

Eval framework for benchmarking AI agents against HyperDX's observability
platform. Generates deterministic synthetic telemetry (traces + logs) with
planted anomalies, spawns Claude Code as an SRE agent with access to either
the HyperDX MCP server or a raw ClickHouse MCP, records full trajectories,
and grades answers using programmatic checks + an LLM-as-judge.

## Prerequisites

- **`yarn dev` running** so ClickHouse, MongoDB, and the HyperDX API are up
- **`claude` CLI installed** (the harness spawns it in streaming JSON mode)
- **`ANTHROPIC_API_KEY`** exported (for the `run` and `grade` commands)
- **[`uv`](https://docs.astral.sh/uv/)** installed (the ClickHouse MCP server
  is launched via `uv run --with mcp-clickhouse`; without `uv` on `PATH` the
  MCP process silently fails to start and the agent gets no tools)

Port detection is automatic — the CLI computes the same worktree-based slot
as `scripts/dev-env.sh`, so no manual `source` step is needed.

## Quick Start

```bash
# 1. One-time setup: register eval account + create Sources
yarn workspace @hyperdx/hdx-eval dev setup-hyperdx

# 2. Seed a scenario (use --volume-factor 0.1 for faster iteration)
yarn workspace @hyperdx/hdx-eval dev seed error-root-cause --volume-factor 0.1

# 3. Run the agent eval (both MCPs, 3 runs each)
ANTHROPIC_API_KEY=sk-... yarn workspace @hyperdx/hdx-eval dev run error-root-cause

# 4. Grade the batch
yarn workspace @hyperdx/hdx-eval dev grade <batch>

# 5. Generate a markdown report
yarn workspace @hyperdx/hdx-eval dev report <batch>
```

## Scenarios

Each scenario writes into its own ClickHouse tables
(`eval_<scenario>_otel_traces` / `eval_<scenario>_otel_logs`) whose schema
mirrors HyperDX's `otel_traces` / `otel_logs` exactly.

| Scenario | Agent Prompt | What's Planted |
|---|---|---|
| `error-root-cause` | "Checkout requests are failing for some users in the last 10 minutes. Find the root cause." | `payment-service` DB connection timeout cascading into `checkout-api` 5xx. 6M+ background spans, 12M logs, 5 distractor anomalies. |
| `latency-spike` | "p99 latency on api-server has jumped in the last 15 minutes. What's slow and why?" | `/api/orders/search` p99 spike for enterprise tenants (missing-index DB query). 12M+ spans, 5 regions, 5K tenants, GC/cold-start/cache distractors. |
| `noisy-signals` | "We want to cut log ingest cost. What are the top noisy signals we should drop or throttle?" | ~16M logs across composite (service, severity) cells. Each noisy cell also has a high-volume load-bearing pattern — grouping by service+severity alone won't work. |
| `segmented-regression` | "API error rate has gone up in the last 10 minutes for some users. Find the segment(s)." | Enterprise x cache-miss errors at ~12% from a schema-mismatch bug. Single-axis aggregates dilute the signal. Concurrent recommendation-service 502 burst as distractor. |
| `service-health-check` | "Generate a service health report for api-server for the last hour." | Peace-time report — no incident, but 4 novel-but-non-critical signals to call out, plus recurring baseline patterns the agent should NOT escalate. |

Use `--volume-factor` to scale background row counts for faster iteration.
Planted anomaly counts stay fixed regardless of the factor.

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
# One-time: register account, create ClickHouse connection, create Sources
dev setup-hyperdx
dev setup-hyperdx --api-url http://localhost:30176  # explicit port
dev setup-hyperdx --check                           # validate existing config
dev setup-hyperdx --reset-sources                   # recreate all Sources
```

### Data Management

```bash
dev list                                    # list scenarios + tables
dev seed <scenario>                         # seed with defaults (seed=42, now=Date.now())
dev seed <scenario> --seed 7                # custom PRNG seed
dev seed <scenario> --now 2026-05-08T15:00:00Z  # fixed anchor time
dev seed <scenario> --volume-factor 0.1     # 10% background volume
dev drop <scenario>                         # drop scenario tables
```

### Running Evals

```bash
dev run <scenario>                          # both MCPs, 3 runs each
dev run <scenario> --mcp hyperdx            # HyperDX MCP only
dev run <scenario> --mcp clickhouse         # raw ClickHouse MCP only
dev run <scenario> --runs 5                 # 5 runs per cell
dev run <scenario> --model claude-sonnet-4-6
dev run <scenario> --max-turns 20           # default: 15
dev run <scenario> --concurrency 4          # parallel cells
dev run <scenario> --prompt-variant hypothesis  # hypothesis-first variant
dev run <scenario> --no-reseed --anchor-time 2026-05-08T15:00:00Z
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
dev grade <batch>                           # programmatic + LLM-as-judge (Opus 4.7)
dev grade <batch> --judge-model claude-sonnet-4-6
dev grade <batch> --no-judge                # programmatic checks only (no LLM cost)
dev grade <batch> --rerun-judge             # re-run judge even if grades exist
dev report <batch>                          # render _summary.md + _summary.json
```

### Viewer

```bash
yarn workspace @hyperdx/hdx-eval viewer    # web UI at http://localhost:3333
```

## Scoring

Combined score = `0.4 * programmatic + 0.6 * judge - toolErrorPenalty`

- **Programmatic (40%)** — regex-based keyword checks against the final
  answer, defined per-scenario in `ground-truth.json`.
- **LLM-as-judge (60%)** — multi-criteria rubric scored 0-5 by Claude Opus 4.7
  (configurable). Criteria are scenario-specific.
- **Tool error penalty** — up to 20% deducted for high tool-call error rates.
  Prevents agents from papering over correctness with volume.

## Bulk Eval

`scripts/fast-eval.sh` seeds all scenarios at a shared anchor time in
parallel, then runs them concurrently. Reads the API key from
`~/.config/hdx-eval-anthropic-key`.

```bash
# Defaults: 4 scenarios, 2 runs/cell, concurrency 2
./packages/hdx-eval/scripts/fast-eval.sh

# Override
SCENARIOS="error-root-cause latency-spike" RUNS=3 \
  ./packages/hdx-eval/scripts/fast-eval.sh
```

There are also scripts for ablation studies (`scripts/ablation.sh`) and
prompt variant comparison (`scripts/compare-prompt-variants.sh`).

## Determinism

All randomness flows through a `mulberry32(seed)` PRNG. Same `(seed, now)`
produces byte-identical row content. This is what makes side-by-side
comparison of HyperDX MCP vs ClickHouse MCP meaningful.

## Tests

```bash
yarn workspace @hyperdx/hdx-eval ci:unit   # all unit tests
yarn workspace @hyperdx/hdx-eval dev:unit  # watch mode
```

Unit tests verify PRNG determinism, planted anomaly invariants, grading
pipeline, stream parsing, prompt construction, and report aggregation.
No ClickHouse needed.
