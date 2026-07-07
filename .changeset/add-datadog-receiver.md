---
"@hyperdx/api": minor
"@hyperdx/otel-collector": minor
---

Add an opt-in Datadog receiver (gated behind `ENABLE_DATADOG_RECEIVER`) so a
Datadog Agent can ship traces, metrics, and logs to HyperDX. The contrib
`datadogreceiver` is compiled into the collector binary and, when enabled, the
OpAMP controller attaches it (listening on `0.0.0.0:8126`) to the traces,
metrics, and logs pipelines. When collector authentication is enforced, the
receiver validates the `DD-API-KEY` header against team API keys.
