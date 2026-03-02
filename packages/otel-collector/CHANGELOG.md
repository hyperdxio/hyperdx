# @hyperdx/otel-collector

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
