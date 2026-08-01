# @hyperdx/hdx-eval

## 0.3.0

### Minor Changes

- c4a22330: feat(evals): support an independent inference model/provider for LLM-as-judge
  grading. The grader can now differ from the run model (e.g. run with Anthropic,
  grade with OpenAI) to reduce same-model bias. `--judge-model` accepts a
  `provider:model` spec (`anthropic`, `openai`; a bare model name defaults to
  anthropic), configurable per repo via `eval.config.json` `grading.judgeModel`.
  The judge now uses the Vercel AI SDK, so grader credentials come from
  `AI_API_KEY`/`OPENAI_API_KEY`/`ANTHROPIC_API_KEY` (plus `AI_BASE_URL` /
  `AI_REQUEST_HEADERS`), mirroring the API package. The provider-specific key
  takes precedence over `AI_API_KEY` so a runner key and a differing grader key
  don't collide.

  The judge prompt now defines explicit 0-5 scoring anchors so scores stay
  calibrated across judge models, and the judge is more robust to intermittent
  structured-output malformations (recovers nested/stringified `scores` payloads
  and retries once on schema failure). Reasoning judge models (OpenAI gpt-5.x /
  o-series) get a larger output-token budget so hidden reasoning tokens don't
  truncate the JSON.

  fix(evals): re-grading a batch with a different judge model now actually
  re-runs that judge instead of silently returning the previously cached judge's
  scores. The `needsJudge` check and per-run reuse guard were keyed on the mere
  presence of a cached judge, not its identity, so `grade <batch> --judge-model
openai:gpt-5.6-sol` over an Opus-graded batch would skip the LLM call and hand
  back the stale Opus scores. Both now key on the judge spec: a cached grade from
  a different judge model is treated as stale. `--rerun-judge` still forces a
  refresh with the same judge. This is required for grader-bias comparisons
  (grading one batch with two judges).

### Patch Changes

- 9b2f9ce7: feat(evals): harden the metric-saturation scenario
- fe5dfbb1: feat(evals): grade & report metric-tool adoption
- cd1c2b21: feat(evals): add metrics-saturation scenario

## 0.2.2

### Patch Changes

- 1705b37a: fix: Block webhook URLs targeting known-bad IP ranges
- ab9dbcdf: feat(evals): support metric types and seeding

## 0.2.1

### Patch Changes

- 81e151c82: Add dashboard-build eval scenario with post-run artifact inspection
- 64d0bbe5: Add optional scenario hooks for custom system prompts, tool permissions, judge preambles, and post-run artifact inspection
- bb7ae21e8: Upgrade the TypeScript devDependency from 5.9 to 6.0 across all packages.

## 0.2.0

### Minor Changes

- 5bd1c681: feat: add AI eval framework for benchmarking MCP servers

  New `@hyperdx/hdx-eval` package for benchmarking AI agents against
  observability MCP servers. Generates deterministic synthetic telemetry
  with planted anomalies, spawns Claude Code as an SRE agent, records full
  trajectories, and grades answers using programmatic checks and an
  LLM-as-judge.

  Includes 5 scenarios (error-root-cause, latency-spike, noisy-signals,
  segmented-regression, service-health-check), MCP-agnostic N-way
  comparison, blinded judging, and a web viewer for browsing results.

### Patch Changes

- 6a800318: Support multi-model comparison in eval batches via comma-separated --model flag
- 1a64796c1: Removing relative imports and using path aliases
