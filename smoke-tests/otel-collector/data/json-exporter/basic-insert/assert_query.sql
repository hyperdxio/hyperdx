SELECT
    Body,
    toString(LogAttributes.`user.id`),
    toString(LogAttributes.`request.method`),
    toString(LogAttributes.`http.status_code`),
    toString(LogAttributes.error)
FROM otel_json.otel_logs
WHERE toString(ResourceAttributes.`suite-id`) = 'json-exporter'
  AND toString(ResourceAttributes.`test-id`) = 'basic-insert'
ORDER BY Timestamp
FORMAT CSV
