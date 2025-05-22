SELECT SeverityText FROM otel_logs WHERE ResourceAttributes['suite-id'] = 'normalize-severity' AND ResourceAttributes['test-id'] = 'text-case' ORDER BY TimestampTime FORMAT CSV
