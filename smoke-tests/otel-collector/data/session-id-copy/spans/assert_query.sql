SELECT
    SpanName,
    mapContains(SpanAttributes, 'session.id'),
    SpanAttributes['session.id'],
    ResourceAttributes['rum.sessionId']
FROM otel_traces
WHERE ResourceAttributes['suite-id'] = 'session-id-copy'
  AND ResourceAttributes['test-id'] = 'spans'
ORDER BY Timestamp
FORMAT CSV
