---
'@hyperdx/otel-collector': minor
---

chore(otel-collector): bump base collector to v0.154.0

Upgrade the custom OTel Collector base from contrib v0.149.0 (core 1.55.0) to
v0.154.0 (core 1.60.0). Updates `OTEL_COLLECTOR_VERSION` /
`OTEL_COLLECTOR_CORE_VERSION` in `.env`, both Dockerfile ARG defaults, and the
smoke-test compose fallbacks.

Compatibility: no config changes required. Reviewed contrib and core breaking
changes across v0.150–v0.154 against every component HyperDX uses. All affected
upstream changes are either backward-compatible deprecation aliases
(`prometheusremotewrite`, `resourcedetection`), explicit-config no-ops for
HyperDX (clickhouse exporter already sets `json:` directly; transform/routing
connectors set `error_mode: ignore` explicitly), or internal core feature-gate
stabilizations.
