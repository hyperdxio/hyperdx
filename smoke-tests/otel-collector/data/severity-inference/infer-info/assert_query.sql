SELECT SeverityText, SeverityNumber, Body FROM otel_logs WHERE ResourceAttributes['suite-id'] = 'severity-inference' AND ResourceAttributes['test-id'] = 'infer-info' ORDER BY TimestampTime FORMAT CSV
