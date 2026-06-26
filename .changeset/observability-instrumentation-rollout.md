---
'@hyperdx/api': minor
---

Extend observability instrumentation to the remaining API surfaces using the
shared helpers. Add custom metrics and tracing to previously log-only paths:
OpAMP message handling (message outcomes, agent status reports, remote configs
sent), the Prometheus proxy router (query duration + swallowed-error counters
labeled by endpoint and backend), alert webhook/notification delivery (delivery
attempts and duration labeled by service and outcome), and MongoDB connection
lifecycle events.

Add a reusable SLO primitive (`withOperationMetrics` / `recordOperationOutcome`)
that emits standard availability + latency SLIs (`hyperdx.operation.requests`
and `hyperdx.operation.duration_ms`, labeled by `operation` and `outcome`) so
SLOs can be defined per piece of application functionality. Apply it to the AI
assistant generation call, the ClickHouse proxy (query passthrough +
connection test), and alert processing — both the end-to-end alert evaluation
(`alerts.evaluate`, excluding scheduling skips) and its ClickHouse data fetch
(`alerts.query`) — paths whose failures previously surfaced only as logs or
failures-only counters with no latency or denominator.
