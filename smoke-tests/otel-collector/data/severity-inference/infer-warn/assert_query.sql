SELECT SeverityText, SeverityNumber, Body FROM otel_logs WHERE ResourceAttributes['suite-id'] = 'severity-inference' AND ResourceAttributes['test-id'] = 'infer-warn' ORDER BY TimestampTime FORMAT CSV
