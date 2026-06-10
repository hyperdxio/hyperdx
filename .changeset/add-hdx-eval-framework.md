---
'@hyperdx/hdx-eval': minor
---

feat: add AI eval framework for benchmarking MCP servers

New `@hyperdx/hdx-eval` package for benchmarking AI agents against
observability MCP servers. Generates deterministic synthetic telemetry
with planted anomalies, spawns Claude Code as an SRE agent, records full
trajectories, and grades answers using programmatic checks and an
LLM-as-judge.

Includes 5 scenarios (error-root-cause, latency-spike, noisy-signals,
segmented-regression, service-health-check), MCP-agnostic N-way
comparison, blinded judging, and a web viewer for browsing results.
