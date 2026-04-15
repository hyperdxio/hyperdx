SELECT name, type
FROM system.columns
WHERE database = 'otel_json'
  AND table = 'otel_logs'
  AND name IN ('ResourceAttributes', 'LogAttributes')
ORDER BY name
FORMAT CSV
