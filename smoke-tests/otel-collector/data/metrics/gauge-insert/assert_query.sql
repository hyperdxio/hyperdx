SELECT
    MetricName,
    ServiceName,
    toString(Attributes['room']),
    Value
FROM otel_metrics_gauge
WHERE ResourceAttributes['suite-id'] = 'metrics'
  AND ResourceAttributes['test-id'] = 'gauge-insert'
ORDER BY TimeUnix
FORMAT CSV
