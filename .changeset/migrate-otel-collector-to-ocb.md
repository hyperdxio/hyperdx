---
'@hyperdx/otel-collector': minor
---

feat: Migrate OTel Collector build to use OCB (OpenTelemetry Collector Builder)

Replace the pre-built otel/opentelemetry-collector-contrib image with a custom
binary built via OCB. This enables adding custom receiver/processor components
in the future while including only the components HyperDX needs. The collector
version is now centralized in `.env` via `OTEL_COLLECTOR_VERSION` and
`OTEL_COLLECTOR_CORE_VERSION`, with `builder-config.yaml` using templatized
placeholders substituted at Docker build time.
