---
'@hyperdx/otel-collector': patch
---

refactor: Deprecate clickhouse.json feature gate in favor of per-exporter json config

Replace the upstream-deprecated `--feature-gates=clickhouse.json` CLI flag with
the per-exporter `json: true` config option controlled by
`HYPERDX_OTEL_EXPORTER_CLICKHOUSE_JSON_ENABLE`. The old
`OTEL_AGENT_FEATURE_GATE_ARG` is still supported for backward compatibility but
prints a deprecation warning when `clickhouse.json` is detected.
