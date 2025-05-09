SELECT SeverityText, SeverityNumber, Body FROM otel_logs WHERE ResourceAttributes['suite-id'] = 'hdx-1514' AND ResourceAttributes['test-id'] = 'skip-infer' ORDER BY TimestampTime FORMAT CSV
