SELECT ResourceAttributes, LogAttributes FROM otel_logs WHERE ResourceAttributes['suite-id'] = 'auto-parse' AND ResourceAttributes['test-id'] = 'default' ORDER BY TimestampTime FORMAT CSV
