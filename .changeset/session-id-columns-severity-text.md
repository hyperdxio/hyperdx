---
'@hyperdx/otel-collector': patch
---

feat: session ID columns, `session.id` from `rum.sessionId`, severity text

The `hyperdx_sessions` seed adds materialized `rum.sessionId` and `session.id`
columns with skip indexes, and the `otel_logs` seed adds a materialized
`session.id` column with a skip index, so session queries no longer read the
attribute maps. Only newly created tables get them; existing tables need an
`ALTER TABLE ... ADD COLUMN` to benefit.

Spans, logs and session replay events from older `@hyperdx/browser` SDKs, which
carry the session id only in the `rum.sessionId` resource attribute, now also
get the OpenTelemetry `session.id` attribute. An existing `session.id` is never
overwritten and `rum.sessionId` is kept. If you override pipeline `processors:`
lists in `CUSTOM_OTELCOL_CONFIG_FILE`, add `transform/session_id` to keep this.

Logs that carry a severity number but no severity text, such as those from the
new browser SDK, now get the matching level text (`info`, `error`, ...) instead
of an empty level. Severity text set by the producer is never overwritten.
