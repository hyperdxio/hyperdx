---
'@hyperdx/app': minor
'@hyperdx/api': minor
'@hyperdx/common-utils': minor
---

Add UI support for configuring an external Prometheus-compatible endpoint on a
connection. Modify Connections model to now have a boolean
`isPrometheusEndpoint` field and use host for storing the host.
