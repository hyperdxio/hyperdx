# @hyperdx/common-utils

## 0.13.0

### Minor Changes

- 051276fc: feat: pie chart now available for chart visualization
- b676f268: feat: Add config property to external dashboard APIs. Deprecate series.

### Patch Changes

- 4f1da032: fix: clickstack build fixed when running same-site origin by omitting credentials from Authorization header for local mode fetch

## 0.12.3

### Patch Changes

- a8aa94b0: feat: add filters to saved searches
- c3bc43ad: fix: Avoid using bodyExpression for trace sources

## 0.12.2

### Patch Changes

- b6c34b13: fix: Handling non-monotonic sums

## 0.12.1

### Patch Changes

- 6cfa40a0: feat: Add support for querying nested/array columns with lucene

## 0.12.0

### Minor Changes

- f44923ba: feat: Add auto-detecting and creating OTel sources during onboarding

## 0.11.1

### Patch Changes

- 6aa3ac6f: fix: Fix missing negation in binary lucene expressions
- b8ab312a: chore: improve Team typing

## 0.11.0

### Minor Changes

- bc8c4eec: feat: allow applying session settings to queries

### Patch Changes

- 1cf8cebb: feat: Support JSON Sessions
- 418828e8: Add better types for AI features, Fix bug that could cause page crash when generating graphs
- 79398be7: chore: Standardize granularities
- 00854da8: feat: Add support for searching with bloom_filter(tokens()) indexes
- f98fc519: perf: Query filter values from MVs
- f20fac30: feat: force usage of the map key index with lucene rendered queries
- 4a856173: feat: Add hasAllTokens for text index support

## 0.10.2

### Patch Changes

- ab7645de: feat: Add a minimum date to MV configuration
- ebaebc14: feat: Use materialized views in alert execution
- 725dbc2f: feat: Align line/bar chart date ranges to chart granularity
- 0c16a4b3: feat: Align date ranges to MV Granularity

## 0.10.1

### Patch Changes

- 103c63cc: chore(eslint): enable @typescript-eslint/no-unsafe-type-assertion rule (warn)
- 103c63cc: refactor(common-utils): improve type safety and linting for type assertions

## 0.10.0

### Minor Changes

- ca693c0f: Add support for visualizing histogram counts
- a5a04aa9: feat: Add materialized view support (Beta)

### Patch Changes

- 50ba92ac: feat: Add custom filters to the services dashboard"
- b58c52eb: fix: Fix bugs in the Services dashboard

## 0.9.0

### Minor Changes

- 52d27985: chore: Upgrade nextjs, react, and eslint + add react compiler

### Patch Changes

- 586bcce7: feat: Add previous period comparisons to line chart
- ea25cc5d: fix: Support formatting queries with % operator
- b7789ced: chore: deprecate unused go-parser service
- ff422206: fix: Fix Services Dashboard Database tab charts
- 59422a1a: feat: Add custom attributes for individual rows
- 7405d183: bump typescript version
- 770276a1: feat: Add search to trace waterfall

## 0.8.0

### Minor Changes

- f612bf3c: feat: add support for alert auto-resolve

### Patch Changes

- f612bf3c: feat: support incident.io integration
- f612bf3c: fix: handle group-by alert histories
- c4915d45: feat: Add custom trace-level attributes above trace waterfall
- 6e628bcd: feat: Support field:(<term>...) Lucene searches

## 0.7.2

### Patch Changes

- 2162a690: feat: Optimize and fix filtering on toStartOfX primary key expressions
- 8190ee8f: perf: Improve getKeyValues query performance for JSON keys

## 0.7.1

### Patch Changes

- 35c42222: fix: Improve table key parsing
- b68a4c9b: Tweak getMapKeys to leverage one row limiting implementation
- 5efa2ffa: feat: handle k8s metrics semantic convention updates
- 43e32aaf: fix: handle metrics semantic convention upgrade (feature gate)
- 3c8f3b54: fix: Include connectionId in metadata cache key
- 65872831: fix: Preserve original select from time chart event selection
- b46ae2f2: fix: Fix sidebar when selecting JSON property
- 2f49f9be: fix: ignore max_rows_to_read for filter values distribution
- daffcf35: feat: Add percentages to filter values
- 5210bb86: refactor: clean up table connections

## 0.7.0

### Minor Changes

- 6c8efbcb: feat: Add persistent dashboard filters

### Patch Changes

- 8673f967: fix: json getKeyValues (useful for autocomplete)
- 4ff55c0e: perf: disable CTE if disableRowLimit flag is true (getKeyValues method)
- 816f90a3: fix: disable json filters for now
- 24314a96: add dashboard import/export functionality
- 8f06ce7b: perf: add prelimit CTE to getMapKeys query + store clickhouse settings in shared cache
- e053c490: chore: Customize user-agent for Alerts ClickHouse client

## 0.6.0

### Minor Changes

- 5a44953e: feat: Add new none aggregation function to allow fully user defined aggregations in SQL

### Patch Changes

- 0d9f3fe0: fix: Always enable query analyzer to fix compatibility issues with old ClickHouse versions.
- 3d82583f: fix issue where linting could fail locally
- 1d79980e: fix: Fix ascending order in windowed searches

## 0.5.0

### Minor Changes

- fa45875d: Add delta() function for gauge metrics

### Patch Changes

- 45e8e1b6: fix: Update tsconfigs to resolve IDE type errors
- d938b4a4: feat: Improve Slack Webhook validation
- 92224d65: Improve Intellisense on common-utils package
- e7b590cc: fix: Fix invalid valueExpression

## 0.4.0

### Minor Changes

- 25f77aa7: added team level queryTimeout to ClickHouse client

### Patch Changes

- d6f8058e: - deprecate unused packages/api/src/clickhouse
  - deprecate unused route /datasources
  - introduce getJSNativeCreateClient in common-utils
  - uninstall @clickhouse/client in api package
  - uninstall @clickhouse/client + @clickhouse/client-web in app package
  - bump @clickhouse/client in common-utils package to v1.12.1
- aacd24dd: refactor: decouple clickhouse client into browser.ts and node.ts
- 52483f6a: feat: enable filters for json columns
- aacd24dd: bump: default request_timeout to 1hr
- 3f2d4270: style: dedupe codes within \_\_query method and move createClient to the constructor
- ecb20c84: feat: remove useless session source fields

## 0.3.2

### Patch Changes

- 56fd856d: fix: otelcol process in aio build
- 0f242558: fix: Compatibilty with lowercase text skip index

## 0.3.1

### Patch Changes

- d29e2bc: fix: handle the case when `CUSTOM_OTELCOL_CONFIG_FILE` is not specified

## 0.3.0

### Minor Changes

- 6dd6165: feat: Display original query to error messages in search page

### Patch Changes

- 5a59d32: Upgraded NX from version 16.8.1 to 21.3.11

## 0.2.9

### Patch Changes

- 39cde41: fix: k8s event property mappings
- b568b00: feat: introduce team 'clickhouse-settings' endpoint + metadataMaxRowsToRead setting

## 0.2.8

### Patch Changes

- eed38e8: bump node version to 22.16.0

## 0.2.7

### Patch Changes

- 4ce81d4: fix: handle Nullable + Tuple type column + decouple useRowWhere
- 61c79a1: fix: Ensure percentile aggregations on histograms don't create invalid SQL queries due to improperly escaped aliases.

## 0.2.6

### Patch Changes

- 33fc071: feat: Allow users to define custom column aliases for charts

## 0.2.5

### Patch Changes

- 973b9e8: feat: Add any aggFn support, fix select field input not showing up

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
