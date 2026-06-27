---
'@hyperdx/otel-collector': minor
---

chore(otel-collector): bump base collector to v0.155.0

Upgrade the custom OTel Collector base from contrib v0.154.0 (core 1.60.0) to
v0.155.0 (core 1.61.0). Updates `OTEL_COLLECTOR_VERSION` /
`OTEL_COLLECTOR_CORE_VERSION` in `.env`, both Dockerfile ARG defaults, and the
smoke-test compose fallbacks.

Compatibility: no config changes required. Reviewed contrib and core breaking
changes for v0.155.0 against every component HyperDX uses. The removed
`telemetry.UseLocalHostAsDefaultMetricsAddress` core gate has no impact because
the telemetry metrics endpoint is set explicitly (`host: 0.0.0.0`, `port:
8888`), and the `memory_limiter` metric rename does not affect the smoke tests
(which assert on the startup log line and the `batch/lowlatency` metric label,
not memory_limiter metrics). All other breaking changes are in unused components
or internal feature-gate removals.
