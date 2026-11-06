---
'@hyperdx/api': patch
'@hyperdx/app': patch
---

chore: Self-instrument the API, the Next.js server and the browser app with `@clickhouse/clickstack-node` and `@clickhouse/clickstack-browser` instead of `@hyperdx/node-opentelemetry` and `@hyperdx/browser`. HyperDX's own telemetry now uses the stable OpenTelemetry semantic conventions, browser activity arrives as log events, and team/user attributes are set on the request span only, not on every child span. The API still starts the SDK only when `HYPERDX_API_KEY` or `OTEL_EXPORTER_OTLP_HEADERS` is set.
