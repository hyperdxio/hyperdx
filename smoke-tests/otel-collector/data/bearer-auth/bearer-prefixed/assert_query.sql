SELECT Body FROM bearer_auth.otel_logs
WHERE ResourceAttributes['suite-id'] = 'bearer-auth'
  AND ResourceAttributes['test-id'] = 'bearer-prefixed'
ORDER BY Timestamp
FORMAT CSV
