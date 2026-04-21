# @hyperdx/otel-collector

## 2.24.0

### Minor Changes

- 28f374ef: feat: Bump OTel Collector from 0.147.0 to 0.149.0

  Upgrade the OpenTelemetry Collector and all its components from v0.147.0 to
  v0.149.0 (core providers from v1.53.0 to v1.55.0).

- 28f374ef: feat: Migrate OTel Collector build to use OCB (OpenTelemetry Collector Builder)

  Replace the pre-built otel/opentelemetry-collector-contrib image with a custom
  binary built via OCB. This enables adding custom receiver/processor components
  in the future while including only the components HyperDX needs. The collector
  version is now centralized in `.env` via `OTEL_COLLECTOR_VERSION` and
  `OTEL_COLLECTOR_CORE_VERSION`, with `builder-config.yaml` using templatized
  placeholders substituted at Docker build time.

- 0a4fb15d: feat: Add missing core extensions, commonly-used contrib processors/receivers, and filestorage extension

  Add the two missing core extensions (memorylimiterextension, zpagesextension),
  12 commonly-used contrib processors (attributes, filter, resource, k8sattributes,
  tailsampling, probabilisticsampler, span, groupbyattrs, redaction, logdedup,
  metricstransform, cumulativetodelta), 4 commonly-used contrib receivers
  (filelog, dockerstats, k8scluster, kubeletstats), and the filestorage extension
  (used for persistent sending queue in the clickhouse exporter) to
  builder-config.yaml.

### Patch Changes

- cb841457: refactor: Deprecate clickhouse.json feature gate in favor of per-exporter json config

  Replace the upstream-deprecated `--feature-gates=clickhouse.json` CLI flag with
  the per-exporter `json: true` config option controlled by
  `HYPERDX_OTEL_EXPORTER_CLICKHOUSE_JSON_ENABLE`. The old
  `OTEL_AGENT_FEATURE_GATE_ARG` is still supported for backward compatibility but
  prints a deprecation warning when `clickhouse.json` is detected.

- 7953c028: feat: Add between-type alert thresholds

## 2.23.2

## 2.23.1

## 2.23.0

## 2.22.1

### Patch Changes

- 470b2c29: ci: Replace QEMU with native ARM64 runners for release builds

## 2.22.0

## 2.21.0

### Patch Changes

- 53a4b672: chore: update otel collector base image to 0.147.0

## 2.20.0

## 2.19.0

### Patch Changes

- 2c306b69: fix: support tcp with TLS (tcps/tls schemes) and ?secure=true query param in otelcol migrator

## 2.18.0

### Minor Changes

- 4c42fdc3: fix: improve log level extraction with word boundaries in regex

### Patch Changes

- 36da6ff4: chore: bump base alpine 3.23 to address CVE-2025-15467

## 2.17.0

### Patch Changes

- 18c2b375: fix: Fallback to legacy schema when CH JSON feature gate is on
- 629fb52e: feat: introduce HYPERDX_OTEL_EXPORTER_TABLES_TTL to support custom TTL configuration
- baf18da4: feat: add TLS support for OTel collector migration script
- baf18da4: chore: bump otel collector version to v0.136.0
- 18c2b375: fix: support OTEL_AGENT_FEATURE_GATE_ARG in opamp-less mode

## 2.16.0

## 2.15.1

### Patch Changes

- 3dae0e01: fix: copy otel-collector schema directory to AIO image

## 2.15.0

### Minor Changes

- 6f4c8efb: feat: Enforce ClickStack schemas by default

### Patch Changes

- c2a61933: feat: add OTLP auth token support for standalone mode
- 683ec1a8: fix: add TLS parameters for https ClickHouse endpoints in goose DB string

## 2.14.0

### Patch Changes

- 43de4678: feat: allow otel-collector to run without OpAMP server
