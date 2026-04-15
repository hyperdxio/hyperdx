---
'@hyperdx/otel-collector': minor
---

feat: Include all OTel Collector Contrib components in builder-config.yaml

Expand the OCB builder manifest to include all receivers, processors, exporters,
extensions, connectors, and configuration providers from the upstream
opentelemetry-collector-contrib distribution. This allows users to reference any
supported component in their custom OTel config files without the collector
binary failing to load.
