# @hyperdx/common-utils

## 0.2.4

### Patch Changes

- 52ca182: feat: Add ClickHouse JSON Type Support

## 0.2.3

### Patch Changes

- b75d7c0: feat: add robust source form validation and error reporting
- 93e36b5: fix: remove id from post for connection creation endpoint

## 0.2.2

### Patch Changes

- 31e22dc: feat: introduce clickhouse db init script
- 2063774: perf: build next app in standalone mode to cut down images size

## 0.2.1

### Patch Changes

- ab3b5cb: perf: merge api + app packages to dedupe node_modules
- ab387e1: fix: missing types in app build
- fce5ee5: feat: add load more to features and improve querying

## 0.2.0

### Minor Changes

- 79fe30f: Queries depending on numeric aggregates now use the type's default value (e.g. 0) instead of null when dealing with non-numeric data.
- a9dfa14: Added support to CTE rendering where you can now specify a CTE using a full chart config object instance. This CTE capability is then used to avoid the URI too long error for delta event queries.
- e002c2f: Support querying a sum metric as a value instead of a rate
- 759da7a: Support multiple OTEL metric types in source configuration setup.
- e80630c: Add chart support for querying OTEL histogram metric table
- 57a6bc3: feat: BETA metrics support (sum + gauge)

### Patch Changes

- 50ce38f: Histogram metric query test cases
- e935bb6: ci: introduce release-nightly workflow
- 8acc725: Fixes to histogram value computation
- 2e350e2: feat: implement logs > metrics correlation flow + introduce convertV1ChartConfigToV2
- 321e24f: fix: alerting time range filtering bug
- 092a292: fix: autocomplete for key-values complete for v2 lucene
- a6fd5e3: feat: introduce k8s preset dashboard
- 2f626e1: fix: metric name filtering for some metadata
- cfdd523: feat: clickhouse queries are by default conducted through the clickhouse library via POST request. localMode still uses GET for CORS purposes
- 9c5c239: fix: handle 'filters' config (metrics)
- 7d2cfcf: fix: 'Failed to fetch' errors
- fa7875c: feat: add summary and exponential histogram metrics to the source form and database storage
- b16c8e1: feat: compute charts ratio
- c50c42d: add correlate log in trace waterfall chart
- 86465a2: fix: map CLICKHOUSE_SERVER_ENDPOINT to otelcol ch exporter 'endpoint' field
- b51e39c: fix: disable keep_alive on the browser side (ch client)
- b9f7d32: Refactored renderWith to simplify logic and ship more tests with the changes.
- 92a4800: feat: move rrweb event fetching to the client instead of an api route
- eaa6bfa: fix: transform partition_key to be the same format as others
- 4865ce7: Fixes the histogram query to perform quantile calculation across all data points
- 29e8f37: fix: aggCondition issue in sum/gauge/histogram metrics
- 43a9ca1: adopt clickhouse-js for all client side queries
- 7f0b397: feat: queryChartConfig method + events chart ratio
- bd9dc18: perf: reuse existing queries promises to avoid duplicate requests
- 5db2767: Fixed CI linting and UI release task.
- 414ff92: feat: export 'Connection' type
- 000458d: chore: GA v2
- 0cf5358: chore: bump clickhouse client to v1.11.1
- 99b60d5: Fixed sum metric query to pass integration test case from v1.
- 931d738: fix: bugs with showing non otel spans (ex. clickhouse opentelemetry span logs)
- 184402d: fix: use quote for aliases for sql compatibility
- a762203: fix: metadata getAllKeyValues query key scoped to table now
- cd0e4fd: fix: correct handling of gauge metrics in renderChartConfig
- e7262d1: feat: introduce all-one-one (auth vs noauth) multi-stage build
- 321e24f: feat: support 'dateRangeEndInclusive' in timeFilterExpr
- 96b8c50: Fix histogram query metric to support grouping and correct issues with value computation.
- e884d85: fix: metrics > logs correlation flow
- e5a210a: feat: support search on multi implicit fields (BETA)

## 0.2.0-beta.6

### Patch Changes

- e935bb6: ci: introduce release-nightly workflow
- 321e24f: fix: alerting time range filtering bug
- 7d2cfcf: fix: 'Failed to fetch' errors
- fa7875c: feat: add summary and exponential histogram metrics to the source form and database storage
- 86465a2: fix: map CLICKHOUSE_SERVER_ENDPOINT to otelcol ch exporter 'endpoint' field
- b51e39c: fix: disable keep_alive on the browser side (ch client)
- 43a9ca1: adopt clickhouse-js for all client side queries
- 0cf5358: chore: bump clickhouse client to v1.11.1
- a762203: fix: metadata getAllKeyValues query key scoped to table now
- e7262d1: feat: introduce all-one-one (auth vs noauth) multi-stage build
- 321e24f: feat: support 'dateRangeEndInclusive' in timeFilterExpr
- 96b8c50: Fix histogram query metric to support grouping and correct issues with value computation.

## 0.2.0-beta.5

### Patch Changes

- 931d738: fix: bugs with showing non otel spans (ex. clickhouse opentelemetry span logs)

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
