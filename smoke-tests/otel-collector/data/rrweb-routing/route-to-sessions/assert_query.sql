SELECT table, Body FROM (
    SELECT 'hyperdx_sessions' AS table, Body, Timestamp
    FROM hyperdx_sessions
    WHERE ResourceAttributes['suite-id'] = 'rrweb-routing'
      AND ResourceAttributes['test-id'] = 'route-to-sessions'
    UNION ALL
    SELECT 'otel_logs' AS table, Body, Timestamp
    FROM otel_logs
    WHERE ResourceAttributes['suite-id'] = 'rrweb-routing'
      AND ResourceAttributes['test-id'] = 'route-to-sessions'
)
ORDER BY table, Timestamp
FORMAT CSV
