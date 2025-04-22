SELECT ResourceAttributes, LogAttributes FROM otel_logs WHERE ResourceAttributes['suite-id'] = 'auto-parse' AND ResourceAttributes['test-id'] = 'json-string' ORDER BY TimestampTime FORMAT CSV
