SELECT
    Body,
    LogAttributes['session.id'],
    `__hdx_materialized_session.id`,
    `__hdx_materialized_rum.sessionId`
FROM hyperdx_sessions
WHERE ResourceAttributes['suite-id'] = 'session-id-copy'
  AND ResourceAttributes['test-id'] = 'replay'
ORDER BY Timestamp
FORMAT CSV
