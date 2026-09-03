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

Query parameters on the Connection host are now only a fallback for a fixed
set of real Prometheus API params (`query`, `time`, `start`, `end`, `step`,
`match`/`match[]`, `limit`, `timeout`, `stats`): a request value for one of
these (including repeatable ones such as `match[]`) always wins and replaces
a same-named host value outright, rather than being dropped. Any other host
query key the request never mentions -- for example
`?extra_label=namespace%3Dprod` pinning a VictoriaMetrics tenant scope -- is
left as-is and is never overridable by the request, since a param name
outside that fixed set is not forwarded at all regardless of what the host
carries. This also means a host copied with a stray query string (not just a
stray path) now forwards its non-Prometheus keys upstream as a fallback on
every request -- trim those too if they weren't intended as Prometheus API
params.

This is also a behavior change for a direct API caller (e.g. curl or
Terraform) that previously relied on sending an arbitrary, non-Prometheus
query param through this endpoint: that param is now silently dropped rather
than forwarded, regardless of whether the Connection host carries anything
under the same name.
