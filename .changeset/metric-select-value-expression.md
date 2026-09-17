---
'@hyperdx/api': patch
---

Accept metric selects without a value expression on the external dashboards API. A tile that aggregates a metric names its value with `metricName` and has no expression to give, so `/api/v2/dashboards/validate` was rejecting dashboards the editor itself writes, and Terraform could not import them.
