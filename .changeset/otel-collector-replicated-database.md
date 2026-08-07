---
'@hyperdx/otel-collector': minor
---

Add support for the ClickHouse Replicated (DatabaseReplicated) database engine
to the collector's schema seed. Setting
`HYPERDX_OTEL_EXPORTER_CLICKHOUSE_DATABASE_ENGINE=Replicated` makes the seed
ensure the target database uses the Replicated engine (creating it, or
converting an empty non-Replicated database, mirroring clickhouse-operator's
`enableDatabaseSync` behavior; a non-empty database is never dropped, and the
conversion renames the old database aside and re-verifies emptiness before
dropping it, so tables created concurrently with the check are preserved
rather than cascade-dropped). Whenever
the target database uses the Replicated engine — regardless of the env var —
table engines are rewritten to their replicated variants (`MergeTree` →
`ReplicatedMergeTree`, `SummingMergeTree` → `ReplicatedSummingMergeTree`) so
table data replicates across replicas.
