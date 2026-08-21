---
'@hyperdx/api': minor
---

The API now recovers from a MongoDB that is unreachable at startup, and exposes a Mongo-aware readiness endpoint. Previously a failed initial connect was never retried: the process kept listening while every Mongo-backed request timed out, `/health` reported 200, and Kubernetes kept the pod Ready indefinitely — cascading into OpAMP 500s and crash-looping collectors. The initial connection is now retried with capped exponential backoff until it succeeds, and both the API and OpAMP servers expose `GET /ready`, which returns 503 unless MongoDB is connected (point Kubernetes readiness probes at it; `/health` remains a pure liveness check).
