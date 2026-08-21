---
'@hyperdx/api': patch
'@hyperdx/otel-collector': patch
---

Allow the ClickHouse exporter request timeout to be configured with
`HYPERDX_OTEL_EXPORTER_TIMEOUT` in both OpAMP-managed and standalone collector
modes. The default remains 5 seconds.
