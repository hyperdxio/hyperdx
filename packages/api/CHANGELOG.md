# @hyperdx/api

## 2.0.0-beta.13

### Patch Changes

- 50ce38f: Histogram metric query test cases
- 2e350e2: feat: implement logs > metrics correlation flow + introduce convertV1ChartConfigToV2
- b9f7d32: Refactored renderWith to simplify logic and ship more tests with the changes.
- 5db2767: Fixed CI linting and UI release task.
- d326610: feat: introduce RUN_SCHEDULED_TASKS_EXTERNALLY + enable in-app task
- 414ff92: perf + fix: single clickhouse proxy middleware instance
- Updated dependencies [50ce38f]
- Updated dependencies [2e350e2]
- Updated dependencies [a6fd5e3]
- Updated dependencies [a9dfa14]
- Updated dependencies [e002c2f]
- Updated dependencies [b9f7d32]
- Updated dependencies [eaa6bfa]
- Updated dependencies [bd9dc18]
- Updated dependencies [5db2767]
- Updated dependencies [414ff92]
- Updated dependencies [e884d85]
- Updated dependencies [e5a210a]
  - @hyperdx/common-utils@0.2.0-beta.2

## 2.0.0-beta.12

### Patch Changes

- fix: use quote for aliases for sql compatibility
- Updated dependencies
  - @hyperdx/common-utils@0.2.0-beta.1

## 2.0.0-beta.11

### Minor Changes

- 759da7a: Support multiple OTEL metric types in source configuration setup.

### Patch Changes

- 99b60d5: Fixed sum metric query to pass integration test case from v1.
- cd0e4fd: fix: correct handling of gauge metrics in renderChartConfig
- Updated dependencies [8acc725]
- Updated dependencies [9c5c239]
- Updated dependencies [c50c42d]
- Updated dependencies [759da7a]
- Updated dependencies [e80630c]
- Updated dependencies [29e8f37]
- Updated dependencies [99b60d5]
- Updated dependencies [57a6bc3]
- Updated dependencies [cd0e4fd]
  - @hyperdx/common-utils@0.2.0-beta.0

## 2.0.0-beta.10

### Patch Changes

- adc2a0b: fix: Ensure errors from proxy are shown to the user

## 2.0.0-beta.0

## 1.9.0

### Minor Changes

- 2488882: Allow to filter search results by event type (log or span)

### Patch Changes

- 63e7d30: fix: Properly show session replays from very long sessions in client
  sessions search results
- 884938a: fix: doesExceedThreshold greater than logic
- 25faa4d: chore: bump HyperDX SDKs (node-opentelemetry v0.8.0 + browser 0.21.0)
- 288c763: fix: handle null ratio value (alerting)
- da866be: fix: revisit doesExceedThreshold logic
- b192366: chore: bump node to v18.20.3
- 148c92b: perf: remove redundant otel-logs fields (timestamp + spanID +
  traceID)

## 1.8.0

### Minor Changes

- 4d6fb8f: feat: GA service health dashboard + metrics alert
- 0e365bf: this change enables generic webhooks. no existing webhook behavior
  will be impacted by this change.
- 4d6fb8f: feat: GA k8s dashboard / metrics side panel

### Patch Changes

- eefe597: Show client sessions with no user interactions but has recording by
  default
- b454003: feat: introduce conditional alert routing helper #is_match
- d3e270a: chore: bump vector to v0.37.0
- 3b1fe08: feat + fix: add webhook endpoints validators + parse webhook JSON
  body
- 5fc7c21: feat: use handlebar to build up webhook body
- 4a85e22: chore: bump @clickhouse/client to v0.2.10

## 1.7.0

### Patch Changes

- 095ec0e: fix: histogram AggFn values to be only valid ones (UI)
- 41d80de: feat: parse legacy k8s v1 cluster events
- 7021924: Support '-', ';', '=', and '+' in password
- b87c4d7: fix: dense rank should be computed base on rank value and group
  (multi-series chart)
- a49726e: fix: cache the result conditionally (SimpleCache)
- b83e51f: refactor + perf: decouple and performance opt metrics tags endpoints

## 1.6.0

### Patch Changes

- 9c666fb: Fixed /api/v1/logs/chart from returning null values due to stale
  property type mappings
- 82640b0: feat: implement histogram linear interpolation quantile function
- 8de2c5c: fix: handle py span ids
- c5b1075: Add postGroupWhere filter option to /chart/series endpoint
- 8de2c5c: feat: parse lambda json message
- 8919179: fix: Fixed parsing && and || operators in queries correctly
- 6321d1f: feat: support jk key bindings (to move through events)
- e92bf4f: fix: convert fixed minute unit granularity to Granularity enum
- f10c3be: Add tags to Dashboards and LogViews
- 4a6db40: refactor: rename bulkInsertTeamLogStream to bulkInsertLogStream
- 8de2c5c: feat: add new k8s.pod.status_phase metrics
- 499c537: style: inject ingestor url (otel config file) + aggregator/go-parser
  url (ingestor config file) through env vars
- 8e536e1: chore: bump vector to v0.35.0

## 1.5.0

### Minor Changes

- a0dc1b5: Breaking Search Syntax Change: Backslashes will be treated as an
  escape character for a double quotes (ex. message:"\"" will search for the
  double quote character). Two backslashes will be treated as a backslash
  literal (ex. message:\\ will search for the backslash literal)

### Patch Changes

- b04ee14: feat: support multi group-bys in event series query
- f4360ed: feat: support count per sec/min/hr aggregation functions
- 7bc4cd3: feat: add last_value agg function
- d5fcb57: feat: introduce go-parser service
- 2910461: Bug fix: Restore dashboard filters, use correct field lookup for
  metrics, and remove extra log property type mapping fetches.
- 3c29bcf: feat: display hyperdx version at the bottom of app nav bar
- 9e617ed: ci: setup aggregator int tests
- 5f05081: feat: api to pull service + k8s attrs linkings
- dc88a59: fix: add db.normalized_statement default value
- 3e885bf: fix: move span k8s tags to root
- bfb08f8: perf: add index for pulling alert histories (GET alerts endpoint)
- 1b4607b: fix: services endpoint should return empty array if no custom fields
  found
- 95ddbb8: fix: services endpoint bug (missing log lines results in no matches)
- 76d7d73: fix: GET alerts endpoint

## 1.4.0

### Minor Changes

- ce70319: chore: bump clickhouse client to v0.2.7
- 226a00d: feat: add state field to AlertHistory collection
- 3b8effe: Add specifying multiple series of charts for time/line charts and
  tables in dashboard (ex. min, max, avg all in one chart).
- 29d1e03: fix: infer log level by the order of severity

### Patch Changes

- 9dc7750: fix: extend level inference scanning range
- 8d1a949: perf: disable metrics property type mapping caching
- 423fc22: perf + feat: introduce SimpleCache and specify getMetricsTags time
  range
- 5e37a94: Allow to customize number formats in dashboard charts
- 619bd1a: fix: checkAlerts - add error handling
- 58d928c: feat: transform k8s event semantic conventions
- b8133eb: feat: allow users to specify 'service.name' attr (flyio)
- bb4f90d: Adjust time window for sum-rate alerts

## 1.3.0

### Minor Changes

- ff38d75: feat: extract and ingest more metrics context (aggregation
  temporality, unit and monotonicity)
- 6f2c75e: refactor: split metrics chart endpoint `name` query param into `type`
  and `name` params (changing an internal API) feat: add validation for metrics
  chart endpoint using zod
- 27f1b7e: feat: metrics alerting support
- 8c8c476: feat: add is_delta + is_monotonic fields to metric_stream table
  (REQUIRES DB MIGRATION)
- 20b1f17: feat: external api v1 route (REQUIRES db migration) + Mongo DB
  migration script
- e8c26d8: feat: time format ui addition

### Patch Changes

- 3a93196: Fix Sentry exception rendering error in side panel, add Sentry SDK to
  API server.
- 8c8c476: feat: setup clickhouse migration tool
- 141fce0: Filter out NaN values from metric charts

## 1.2.0

### Minor Changes

- bbda669: Chart alerts: add schemas and read path
- 0824ae7: API: Add support for chart alerts
- b1a537d: feat(register): password confirmation
- 8443a08: feat: implement CHART source alert (scheduled task)
- 7d636f2: feat: enhanced registration form validation

### Patch Changes

- 9a72b85: fix: getLogBatchGroupedByBody missing return bug (regression)
- 42969f2: chore: Add path aliases
- 956e5b5: chore: bump vector to v0.34.0
- f662007: Fixed Sum metric types from over reporting on sum and average aggFns
- 753a175: Fix typescript compilation with path aliases

## 1.1.4

### Patch Changes

- 8cb0eac: Add rate function for sum metrics
- 8591aee: fix: control otel related services logs telemetry using
  HYPERDX_LOG_LEVEL

## 1.1.3

### Patch Changes

- 389bb3a: feat: support HYPERDX_LOG_LEVEL env var
- 1ec122c: fix: aggregator errors handler status code

## 1.1.2

### Patch Changes

- bd37a5e: Filter out empty session replays from session replay search, add
  email filter to session replay UI
- 5d005f7: chore: bump @hyperdx/node-opentelemetry + @hyperdx/browser to latest
- 593c4ca: refactor: set output datetime format on the client side

## 1.1.1

### Patch Changes

- chore: bump @hyperdx/node-logger + @hyperdx/node-opentelemetry

## 1.1.0

### Minor Changes

- 914d49a: feat: introduce usage-stats service
