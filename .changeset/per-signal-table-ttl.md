---
'@hyperdx/otel-collector': minor
---

feat: support per-signal ClickHouse table TTLs and reconcile TTL on existing tables

Adds `HYPERDX_OTEL_EXPORTER_LOGS_TTL`, `HYPERDX_OTEL_EXPORTER_TRACES_TTL`, `HYPERDX_OTEL_EXPORTER_METRICS_TTL` and `HYPERDX_OTEL_EXPORTER_SESSIONS_TTL`, each falling back to the existing `HYPERDX_OTEL_EXPORTER_TABLES_TTL`, so retention can be configured independently per signal (e.g. keep logs and traces for 6 months while metrics stay at 30 days).

When `HYPERDX_OTEL_EXPORTER_RECONCILE_TABLE_TTL=true`, the migrate tool also applies the configured TTL to tables that already exist (`ALTER TABLE ... MODIFY TTL`), diff-guarded so only tables whose retention actually differs are changed. Previously a changed TTL only affected newly-created tables. Extending a retention uses `materialize_ttl_after_modify=1` so data already on disk is kept for the new (longer) period; shrinking uses `=0` so a startup reconcile never triggers a bulk delete (existing parts age out under their old TTL). Multi-interval (tiered) TTLs are left untouched. Off by default. Implements hyperdxio/hyperdx#1311.
