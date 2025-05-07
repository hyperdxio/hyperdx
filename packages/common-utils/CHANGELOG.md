# @hyperdx/common-utils

## 0.2.0-beta.4

### Minor Changes

- 79fe30f: Queries depending on numeric aggregates now use the type's default value (e.g. 0) instead of null when dealing with non-numeric data.

### Patch Changes

- cfdd523: feat: clickhouse queries are by default conducted through the clickhouse library via POST request. localMode still uses GET for CORS purposes
- 92a4800: feat: move rrweb event fetching to the client instead of an api route
- 7f0b397: feat: queryChartConfig method + events chart ratio

## 0.2.0-beta.3

### Patch Changes

- 092a292: fix: autocomplete for key-values complete for v2 lucene
- 2f626e1: fix: metric name filtering for some metadata
- b16c8e1: feat: compute charts ratio
- 4865ce7: Fixes the histogram query to perform quantile calculation across all data points

## 0.2.0-beta.2

### Minor Changes

- a9dfa14: Added support to CTE rendering where you can now specify a CTE using a full chart config object instance. This CTE capability is then used to avoid the URI too long error for delta event queries.
- e002c2f: Support querying a sum metric as a value instead of a rate

### Patch Changes

- 50ce38f: Histogram metric query test cases
- 2e350e2: feat: implement logs > metrics correlation flow + introduce convertV1ChartConfigToV2
- a6fd5e3: feat: introduce k8s preset dashboard
- b9f7d32: Refactored renderWith to simplify logic and ship more tests with the changes.
- eaa6bfa: fix: transform partition_key to be the same format as others
- bd9dc18: perf: reuse existing queries promises to avoid duplicate requests
- 5db2767: Fixed CI linting and UI release task.
- 414ff92: feat: export 'Connection' type
- e884d85: fix: metrics > logs correlation flow
- e5a210a: feat: support search on multi implicit fields (BETA)

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
