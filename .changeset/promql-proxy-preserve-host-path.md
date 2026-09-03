---
'@hyperdx/api': minor
---

fix: preserve a Connection host path prefix when proxying PromQL.
`proxyToPrometheus` joined absolute Prometheus paths (`/api/v1/query_range`,
`/api/v1/query`, `/api/v1/query_exemplars`, `/api/v1/label/.../values`) with
`new URL(path, host)`, which replaces the host pathname instead of appending to
it. VictoriaMetrics cluster `vmselect` URLs such as
`http://vmselect:8481/select/0/prometheus` were rewritten to
`/api/v1/query_range` and rejected. The join now keeps the existing pathname.

This is a behavior change for Connections whose host already included a path
that was never meant as a Prometheus API prefix — for example
`http://prom:9090/graph` copied from the Prometheus UI. That previously happened
to work because the absolute API path replaced `/graph`; requests now go to
`/graph/api/v1/query_range` and will 404. Trim stray paths from existing
Connection hosts before upgrading. Root-mounted hosts (`http://prom:9090` or
`http://prom:9090/`) are unchanged.

Query parameters on the Connection host are now only a fallback: any param the
request supplies (including repeatable ones such as `match[]`) always wins and
replaces a same-named host value outright, rather than being dropped. A
param the request never mentions -- for example `?extra_label=namespace%3Dprod`
pinning a VictoriaMetrics tenant scope -- is left as-is.
