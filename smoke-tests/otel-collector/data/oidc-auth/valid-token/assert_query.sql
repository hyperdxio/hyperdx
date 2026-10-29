SELECT Body FROM oidc_auth.otel_logs
WHERE ResourceAttributes['suite-id'] = 'oidc-auth'
  AND ResourceAttributes['test-id'] = 'valid-token'
ORDER BY Timestamp
FORMAT CSV
