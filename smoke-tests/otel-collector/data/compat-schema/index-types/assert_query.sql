SELECT name, type
FROM system.data_skipping_indices
WHERE database = 'default'
  AND table = 'otel_logs'
  AND name IN ('idx_trace_id', 'idx_lower_body')
ORDER BY name
FORMAT CSV
