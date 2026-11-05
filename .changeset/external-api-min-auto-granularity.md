---
'@hyperdx/api': patch
---

docs: Document `minAutoGranularity` on metric and PromQL sources in the external
API

`GET`, `POST` and `PUT /api/v2/sources` already accepted and returned
`minAutoGranularity`, but the OpenAPI spec omitted it, so clients generated from
the spec dropped or rejected the field.
