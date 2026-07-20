# @hyperdx/hdx-eval

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
