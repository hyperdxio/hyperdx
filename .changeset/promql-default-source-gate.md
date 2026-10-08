---
'@hyperdx/api': patch
---

feat: only provision a default PromQL source when PromQL is enabled

`DEFAULT_SOURCES` entries of kind `promql` are now skipped unless
`ENABLE_PROMQL=true`, so a single sources list can include a PromQL source
without creating it on deployments that have PromQL turned off.
