---
'@hyperdx/otel-collector': patch
---

feat: session ID columns on `hyperdx_sessions`, severity text from severity number

The `hyperdx_sessions` seed adds materialized `rum.sessionId` and `session.id`
columns with skip indexes, so the sessions list and replay lookups no longer
read the table's attribute maps. Only newly created tables get them; existing
tables need an `ALTER TABLE ... ADD COLUMN` to benefit.

Logs that carry a severity number but no severity text, such as those from the
new browser SDK, now get the matching level text (`info`, `error`, ...) instead
of an empty level. Severity text set by the producer is never overwritten.
