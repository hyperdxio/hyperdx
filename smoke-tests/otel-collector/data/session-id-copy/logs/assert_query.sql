SELECT
    Body,
    mapContains(LogAttributes, 'session.id'),
    LogAttributes['session.id'],
    `__hdx_materialized_session.id`
FROM otel_logs
WHERE ResourceAttributes['suite-id'] = 'session-id-copy'
  AND ResourceAttributes['test-id'] = 'logs'
ORDER BY Timestamp
FORMAT CSV
