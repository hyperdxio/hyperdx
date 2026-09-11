---
"@hyperdx/otel-collector": minor
---

feat(otel-collector): compile in statsdreceiver

Available for a user's own pipeline config (e.g. via
`CUSTOM_OTELCOL_CONFIG_FILE`) to ingest StatsD/DogStatsD metrics
directly, without a separate StatsD-to-OTLP bridge. Purely additive:
being compiled in changes no default pipeline or behavior on its own.
