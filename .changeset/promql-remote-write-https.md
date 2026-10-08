---
'@hyperdx/otel-collector': patch
'@hyperdx/api': patch
---

fix: support https for the PromQL remote-write endpoint

`CLICKHOUSE_PROMETHEUS_METRICS_ENDPOINT` now accepts an `http://` or `https://` URL as well as a bare `host:port`. With `https://`, the collector's `prometheusremotewrite` exporter sends metrics over TLS and verifies the server certificate against the system CAs. Previously the exporter always used plain HTTP, so an HTTPS-only endpoint could not receive metrics. This applies to both standalone and OpAMP-managed collectors.

A bare `host:port` keeps plain HTTP, so existing setups are unchanged. The value must not include a path (`/write` is still appended automatically); the collector now exits at startup with a clear error if it does, or if the scheme is anything other than `http` or `https`.
