# @hyperdx/common-utils

## 0.2.0-beta.1

### Patch Changes

- fix: use quote for aliases for sql compatibility

## 0.2.0-beta.0

### Minor Changes

- 759da7a: Support multiple OTEL metric types in source configuration setup.
- e80630c: Add chart support for querying OTEL histogram metric table
- 57a6bc3: feat: BETA metrics support (sum + gauge)

### Patch Changes

- 8acc725: Fixes to histogram value computation
- 9c5c239: fix: handle 'filters' config (metrics)
- c50c42d: add correlate log in trace waterfall chart
- 29e8f37: fix: aggCondition issue in sum/gauge/histogram metrics
- 99b60d5: Fixed sum metric query to pass integration test case from v1.
- cd0e4fd: fix: correct handling of gauge metrics in renderChartConfig

## 0.1.0

### Minor Changes

- 497fba8: Added support for querying gauge metric table with default detection for OTEL collector schema.

## 0.0.14

### Patch Changes

- 621bd55: feat: add session source and SourceKind enum

## 0.0.13

### Patch Changes

- b79433e: refactor: Extract alert configuration schema into AlertBaseSchema

## 0.0.12

### Patch Changes

- 418c293: feat: extract AlertChannelType to its own schema

## 0.0.11

### Patch Changes

- a483780: style: move types from renderChartConfig + add exceptions types

## 0.0.10

### Patch Changes

- fc4548f: feat: add alert schema + types
