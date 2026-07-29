SELECT
    SpanName,
    ServiceName,
    ParentSpanId = '' AS is_root,
    toString(SpanAttributes['http.method']),
    toString(SpanAttributes['db.system'])
FROM otel_traces
WHERE ResourceAttributes['suite-id'] = 'traces'
  AND ResourceAttributes['test-id'] = 'basic-insert'
ORDER BY Timestamp
FORMAT CSV
