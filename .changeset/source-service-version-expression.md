---
'@hyperdx/app': minor
'@hyperdx/api': minor
---

Add an optional `serviceVersionExpression` to log and trace sources, identifying
the running release of a service. Defaults to the OpenTelemetry
`service.version` resource attribute; teams whose release identifier lives
elsewhere, such as a container image tag under GitOps, can point it there
instead of changing instrumentation.
