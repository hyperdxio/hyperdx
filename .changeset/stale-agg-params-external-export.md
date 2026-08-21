---
"@hyperdx/api": patch
---

Stop the external dashboards API returning aggregation parameters the aggregation cannot carry: a `level` left over from a quantile agg, or a `valueExpression` left over on a count. Both are ignored when rendering, but the input schema rejects them, so a GET body could not be PUT back and importing a dashboard into Terraform failed with "Level can only be used with quantile aggregation function".
