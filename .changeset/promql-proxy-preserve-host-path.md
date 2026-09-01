---
'@hyperdx/api': patch
---

fix: preserve a Connection host path prefix when proxying PromQL.
`proxyToPrometheus` joined absolute Prometheus paths (`/api/v1/query_range`,
`/api/v1/query`, `/api/v1/query_exemplars`, `/api/v1/label/.../values`) with
`new URL(path, host)`, which replaces the host pathname instead of appending to
it. VictoriaMetrics cluster `vmselect` URLs such as
`http://vmselect:8481/select/0/prometheus` were rewritten to
`/api/v1/query_range` and rejected. The join now keeps the existing pathname.
