---
'@hyperdx/otel-collector': minor
---

feat: opt-in Replicated database and table engines for the schema seed

When `HYPERDX_OTEL_EXPORTER_CLICKHOUSE_REPLICATED=true`, the migrate tool
creates the target database with the `Replicated` engine and seeds
`ReplicatedMergeTree` / `ReplicatedSummingMergeTree` tables instead of
`MergeTree` / `SummingMergeTree`. If the database already exists with another
engine, it logs a warning and seeds the plain engines as before. Off by default.

The migrate tool also warns when it targets a database other than `default`
while `default` still holds ClickStack tables, since those are not migrated.

With `HYPERDX_OTEL_EXPORTER_CLICKHOUSE_FALLBACK_DATABASE` set (off by default),
a target database that does not exist yet yields to the fallback database when
the fallback already has ClickStack tables. The collector then writes to the
fallback database too.
