---
'@hyperdx/api': patch
---

fix: Reject creating or updating PromQL sources through the external API when PromQL is not enabled

`POST` and `PUT /api/v2/sources` now return a 400 for `kind: "promql"` unless `ENABLE_PROMQL` is set, since PromQL sources cannot be queried without it.
