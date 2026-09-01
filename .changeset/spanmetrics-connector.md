---
"@hyperdx/otel-collector": patch
---

feat(otel-collector): compile in spanmetricsconnector

Available for a user's own pipeline config (e.g. via
`CUSTOM_OTELCOL_CONFIG_FILE`) to compute call-count and duration
metrics from spans - most useful alongside the existing
`datadogreceiver` support for ingesting Datadog Agent traces, where
there was previously no way to derive RED metrics from that trace data
once ingested. Purely additive: being compiled in changes no default
pipeline or behavior on its own.
