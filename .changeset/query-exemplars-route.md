---
'@hyperdx/api': minor
---

feat: add /v1/prometheus/query_exemplars, and harden the Prometheus proxy

Adds a `query_exemplars` route that proxies to Prometheus's native
`/api/v1/query_exemplars` for Prometheus-backed connections, and answers with an
empty success for ClickHouse-backed ones, where exemplars are read from the metric
table instead.

Three fixes to the shared proxy while adding a route to it:

- Responses now carry `X-Content-Type-Options: nosniff`, and the upstream
  content-type is forwarded only when it is a JSON media type. The connection host
  is member-configured, so its response body is untrusted output on our own origin.
- Proxy failures increment `prometheusQueryErrors`. `proxyToPrometheus` handles its
  own failures and returns normally, so the callers' `catch` never ran and all four
  proxied endpoints reported zero errors while still recording duration. Counted on
  5xx only, so a user's malformed PromQL does not read as a backend fault.
- The exemplar window is bounded by narrowing rather than rejecting, so a wide
  dashboard range still works.
