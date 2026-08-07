SELECT engine FROM system.databases WHERE name = 'default' FORMAT CSV;
-- The Atomic -> Replicated conversion renames the old database aside and
-- drops it after re-verifying emptiness; a clean conversion must not leave
-- the fence database behind.
SELECT name FROM system.databases WHERE name LIKE 'default_pre_replicated_%' FORMAT CSV;
SELECT name, engine
FROM system.tables
WHERE database = 'default'
  AND engine != 'MaterializedView'
  AND engine NOT LIKE 'Replicated%'
ORDER BY name
FORMAT CSV;
SELECT engine FROM system.tables WHERE database = 'default' AND name = 'otel_logs' FORMAT CSV;
SELECT engine FROM system.tables WHERE database = 'default' AND name = 'otel_traces' FORMAT CSV;
SELECT engine FROM system.tables WHERE database = 'default' AND name = 'otel_logs_kv_rollup_15m' FORMAT CSV;
SELECT engine FROM system.tables WHERE database = 'default' AND name = 'otel_traces_kv_rollup_15m' FORMAT CSV;
