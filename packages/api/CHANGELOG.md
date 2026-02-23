# @hyperdx/api

## 2.18.0

### Minor Changes

- b676f268: feat: Add config property to external dashboard APIs. Deprecate series.

### Patch Changes

- 18e96904: fix: update required fields in our spec
- Updated dependencies [051276fc]
- Updated dependencies [4f1da032]
- Updated dependencies [b676f268]
  - @hyperdx/common-utils@0.13.0

## 2.17.0

### Patch Changes

- 679b65d7: feat: added configuration to disable frontend otel exporter
- 27f478a6: feat: Add external GET /sources API
- d759d046: support filters in dashboards external api
- a8aa94b0: feat: add filters to saved searches
- c3bc43ad: fix: Avoid using bodyExpression for trace sources
- 9ab68432: Minor fixes in the sources external API: 1. avoid inline schemas, 2. use short format timestamps for materializedView.minGranularity
- Updated dependencies [a8aa94b0]
- Updated dependencies [c3bc43ad]
  - @hyperdx/common-utils@0.12.3

## 2.16.0

### Patch Changes

- Updated dependencies [b6c34b13]
  - @hyperdx/common-utils@0.12.2

## 2.15.1

### Patch Changes

- 6cfa40a0: feat: Add support for querying nested/array columns with lucene
- Updated dependencies [6cfa40a0]
  - @hyperdx/common-utils@0.12.1

## 2.15.0

### Patch Changes

- Updated dependencies [f44923ba]
  - @hyperdx/common-utils@0.12.0

## 2.14.0

### Minor Changes

- 4c287b16: fix: Fix external dashboard endpoints
- 3aa8be0a: Concat zod errors into a single message field
- d07e30d5: Associates a logged in HyperDX user to the ClickHouse query recorded in the query log.

### Patch Changes

- 4e7d04c7: API: Show error "Invalid JSON payload" if the JSON body has a syntax error
- 941bc23e: fix: Fix inaccurate openapi docs for external alerts API
- b8ab312a: chore: improve Team typing
- Updated dependencies [6aa3ac6f]
- Updated dependencies [b8ab312a]
  - @hyperdx/common-utils@0.11.1

## 2.13.0

### Minor Changes

- bc8c4eec: feat: allow applying session settings to queries

### Patch Changes

- d769f88d: Fix issue when a source type is switched after creation
- 418828e8: Add better types for AI features, Fix bug that could cause page crash when generating graphs
- 79398be7: chore: Standardize granularities
- eef80b7e: Add ability to define different anthropic api BASE_URLs, add core logic for different ai providers
- 4a856173: feat: Add hasAllTokens for text index support
- Updated dependencies [1cf8cebb]
- Updated dependencies [418828e8]
- Updated dependencies [79398be7]
- Updated dependencies [bc8c4eec]
- Updated dependencies [00854da8]
- Updated dependencies [f98fc519]
- Updated dependencies [f20fac30]
- Updated dependencies [4a856173]
  - @hyperdx/common-utils@0.11.0

## 2.12.0

### Patch Changes

- ebaebc14: feat: Use materialized views in alert execution
- ac1a2f77: chore: Format OpenAPI docs
- 725dbc2f: feat: Align line/bar chart date ranges to chart granularity
- ae12ca16: feat: Add MV granularities and infer config from SummingMergeTree
- fd81c4cb: chore: bump MongoDB version to 5.0.32
- Updated dependencies [ab7645de]
- Updated dependencies [ebaebc14]
- Updated dependencies [725dbc2f]
- Updated dependencies [0c16a4b3]
  - @hyperdx/common-utils@0.10.2

## 2.11.0

### Patch Changes

- 103c63cc: chore(eslint): enable @typescript-eslint/no-unsafe-type-assertion rule (warn)
- Updated dependencies [103c63cc]
- Updated dependencies [103c63cc]
  - @hyperdx/common-utils@0.10.1

## 2.10.0

### Minor Changes

- a5a04aa9: feat: Add materialized view support (Beta)

### Patch Changes

- 96f0539e: feat: Add silence alerts feature
- e0c23d4e: feat: flush chunk data as it arrives if in order
- 50ba92ac: feat: Add custom filters to the services dashboard"
- b58c52eb: fix: Fix bugs in the Services dashboard
- 0d3da6f7: fix: case sensitivity issue with email invites
- 6d4fc318: feat: add teamsetting for paralellizing queries when possible
- Updated dependencies [ca693c0f]
- Updated dependencies [50ba92ac]
- Updated dependencies [a5a04aa9]
- Updated dependencies [b58c52eb]
  - @hyperdx/common-utils@0.10.0

## 2.9.0

### Minor Changes

- 52d27985: chore: Upgrade nextjs, react, and eslint + add react compiler

### Patch Changes

- cac4d3dd: Allow connecting to Mongo with AWS Auth
- b7789ced: chore: deprecate unused go-parser service
- e838436d: Improve value rounding on alerts to match thresholds
- Updated dependencies [586bcce7]
- Updated dependencies [ea25cc5d]
- Updated dependencies [52d27985]
- Updated dependencies [b7789ced]
- Updated dependencies [ff422206]
- Updated dependencies [59422a1a]
- Updated dependencies [7405d183]
- Updated dependencies [770276a1]
  - @hyperdx/common-utils@0.9.0

## 2.8.0

### Minor Changes

- f612bf3c: feat: add support for alert auto-resolve
- 840d7307: feat: adjust alert template title and body to reflect alert state
- 94a669d3: Add metrics to task execution

### Patch Changes

- 99cb17c6: Add ability to edit and test webhook integrations
- 78aff336: fix: Group alert histories by evaluation time
- f612bf3c: feat: support incident.io integration
- f612bf3c: fix: handle group-by alert histories
- c4915d45: feat: Add custom trace-level attributes above trace waterfall
- a75ce3be: Fix check alert to actually honor concurrent evaluation.
- 44caf197: Zero-fill empty alert periods
- Updated dependencies [f612bf3c]
- Updated dependencies [f612bf3c]
- Updated dependencies [f612bf3c]
- Updated dependencies [c4915d45]
- Updated dependencies [6e628bcd]
  - @hyperdx/common-utils@0.8.0

## 2.7.1

### Patch Changes

- 24b5477d: feat: allow specifying webhook request headers
- c6ad250f: Enable auto-provisioning for no-auth mode
- 778092d3: fix: set a max size for alert timeranges
- Updated dependencies [2162a690]
- Updated dependencies [8190ee8f]
  - @hyperdx/common-utils@0.7.2

## 2.7.0

### Minor Changes

- f4c35239: Allows defining the ClickHouse request timeout value from the command line on the check-alert task
- 348a4044: migration: migrate to Pino for standardized and faster logging
- c90a93e6: Updated the cron package to pick up a fix for stalled cron tasks.

### Patch Changes

- c428d984: fix: Set team and connection attributes on span instead of trace
- 43e32aaf: fix: handle metrics semantic convention upgrade (feature gate)
- 131a1c1e: revert: api esbuild
- e032af55: Add new logging pararmeter for otel collector
- Updated dependencies [35c42222]
- Updated dependencies [b68a4c9b]
- Updated dependencies [5efa2ffa]
- Updated dependencies [43e32aaf]
- Updated dependencies [3c8f3b54]
- Updated dependencies [65872831]
- Updated dependencies [b46ae2f2]
- Updated dependencies [2f49f9be]
- Updated dependencies [daffcf35]
- Updated dependencies [5210bb86]
  - @hyperdx/common-utils@0.7.1

## 2.6.0

### Minor Changes

- 6c8efbcb: feat: Add persistent dashboard filters

### Patch Changes

- 77d0e56f: chore: Add spans for alert processing
- e053c490: chore: Customize user-agent for Alerts ClickHouse client
- Updated dependencies [8673f967]
- Updated dependencies [4ff55c0e]
- Updated dependencies [816f90a3]
- Updated dependencies [24314a96]
- Updated dependencies [8f06ce7b]
- Updated dependencies [e053c490]
- Updated dependencies [6c8efbcb]
  - @hyperdx/common-utils@0.7.0

## 2.5.0

### Patch Changes

- df259392: chore: remove unused npm packages
- 0d9f3fe0: fix: Always enable query analyzer to fix compatibility issues with old ClickHouse versions.
- 140e4d2f: feat: Get ClickHouse client from AlertProvider
- 825452fe: refactor: Decouple alerts processing from Mongo
- Updated dependencies [0d9f3fe0]
- Updated dependencies [3d82583f]
- Updated dependencies [5a44953e]
- Updated dependencies [1d79980e]
  - @hyperdx/common-utils@0.6.0

## 2.4.0

### Patch Changes

- 45e8e1b6: fix: Update tsconfigs to resolve IDE type errors
- d938b4a4: feat: Improve Slack Webhook validation
- fd732a08: perf: Query AlertHistory in bulk
- 5d567b99: test: Add integration test for user removal alert updates
- d9b91124: fix: Update Alerts when creating user is deleted
- Updated dependencies [45e8e1b6]
- Updated dependencies [fa45875d]
- Updated dependencies [d938b4a4]
- Updated dependencies [92224d65]
- Updated dependencies [e7b590cc]
  - @hyperdx/common-utils@0.5.0

## 2.3.0

### Minor Changes

- 25f77aa7: added team level queryTimeout to ClickHouse client

### Patch Changes

- 85685801: feat: INGESTION_API_KEY allows for environment variable defined api key
- eb6f3a01: Fix the alert connection query to include the password field.
- d6f8058e: - deprecate unused packages/api/src/clickhouse
  - deprecate unused route /datasources
  - introduce getJSNativeCreateClient in common-utils
  - uninstall @clickhouse/client in api package
  - uninstall @clickhouse/client + @clickhouse/client-web in app package
  - bump @clickhouse/client in common-utils package to v1.12.1
- aacd24dd: refactor: decouple clickhouse client into browser.ts and node.ts
- bb2221a1: fix: Keep "created by" field unchanged during alert updates in dashboards
- aacd24dd: bump: default request_timeout to 1hr
- f800fd13: Fixes alert title used on dashboards with multiple tiles
- 261d4693: feat: limit how many tasks are executing at any time
- Updated dependencies [25f77aa7]
- Updated dependencies [d6f8058e]
- Updated dependencies [aacd24dd]
- Updated dependencies [52483f6a]
- Updated dependencies [aacd24dd]
- Updated dependencies [3f2d4270]
- Updated dependencies [ecb20c84]
  - @hyperdx/common-utils@0.4.0

## 2.2.2

### Patch Changes

- 56fd856d: fix: otelcol process in aio build
- Updated dependencies [56fd856d]
- Updated dependencies [0f242558]
  - @hyperdx/common-utils@0.3.2

## 2.2.1

### Patch Changes

- d29e2bc: fix: handle the case when `CUSTOM_OTELCOL_CONFIG_FILE` is not specified
- c216053: Changes the order of alert evaluation to group queries by the connection on the alert.
- Updated dependencies [d29e2bc]
  - @hyperdx/common-utils@0.3.1

## 2.2.0

### Minor Changes

- c0b188c: Track the user id who created alerts and display the information in the UI.

### Patch Changes

- ab50b12: feat: support custom otel collector config (BETA)
- ab50b12: fix: reduce bloat in opamp agent logs
- 5a59d32: Upgraded NX from version 16.8.1 to 21.3.11
- Updated dependencies [6dd6165]
- Updated dependencies [5a59d32]
  - @hyperdx/common-utils@0.3.0

## 2.1.2

### Patch Changes

- 39cde41: fix: k8s event property mappings
- b568b00: feat: introduce team 'clickhouse-settings' endpoint + metadataMaxRowsToRead setting
- Updated dependencies [39cde41]
- Updated dependencies [b568b00]
  - @hyperdx/common-utils@0.2.9

## 2.1.1

### Patch Changes

- 1dc1c82: feat: add team setting to disable field metadata queries in app
- eed38e8: bump node version to 22.16.0
- Updated dependencies [eed38e8]
  - @hyperdx/common-utils@0.2.8

## 2.1.0

### Patch Changes

- 4ce81d4: fix: handle Nullable + Tuple type column + decouple useRowWhere
- 21b5df6: fix: Hotfix to prevent the app from crashing due to a strict mode exception
- 6c13403: fix: use '--kill-others-on-fail' to prevent processes from terminating when RUN_SCHEDULED_TASKS_EXTERNALLY is enabled
- 61c79a1: fix: Ensure percentile aggregations on histograms don't create invalid SQL queries due to improperly escaped aliases.
- Updated dependencies [4ce81d4]
- Updated dependencies [61c79a1]
  - @hyperdx/common-utils@0.2.7

## 2.0.6

### Patch Changes

- 33fc071: feat: Allow users to define custom column aliases for charts
- Updated dependencies [33fc071]
  - @hyperdx/common-utils@0.2.6

## 2.0.5

### Patch Changes

- a4f2afa: fix: Add samesite to cookies for better security
- 844f74c: fix: validate name for saved searches
- f7eb1ef: feat: configurable search row limit
- Updated dependencies [973b9e8]
  - @hyperdx/common-utils@0.2.5

## 2.0.4

### Patch Changes

- 52ca182: feat: Add ClickHouse JSON Type Support
- 808145b: feat: specify NODE_ENV in api build (prod stage)
- Updated dependencies [52ca182]
  - @hyperdx/common-utils@0.2.4

## 2.0.3

### Patch Changes

- 93e36b5: fix: remove id from post for connection creation endpoint
- Updated dependencies [b75d7c0]
- Updated dependencies [93e36b5]
  - @hyperdx/common-utils@0.2.3

## 2.0.2

### Patch Changes

- ad68877: feat: bundle api via esbuild for smaller image distribution
- 707ba7f: chore: update deps for http-proxy-middleware
- 31e22dc: feat: introduce clickhouse db init script
- 2063774: perf: build next app in standalone mode to cut down images size
- Updated dependencies [31e22dc]
- Updated dependencies [2063774]
  - @hyperdx/common-utils@0.2.2

## 2.0.1

### Patch Changes

- ab3b5cb: perf: merge api + app packages to dedupe node_modules
- ab387e1: fix: missing types in app build
- d1dc2ec: Bumped mongodb driver support to allow for AWS IAM authentication. This drops support for MongoDB 3.6.
- 43edac8: chore: bump @hyperdx/node-opentelemetry to v0.8.2
- fa11fbb: fix: usage stats missing cluster id
- Updated dependencies [ab3b5cb]
- Updated dependencies [ab387e1]
- Updated dependencies [fce5ee5]
  - @hyperdx/common-utils@0.2.1

## 2.0.0

### Minor Changes

- 79fe30f: Queries depending on numeric aggregates now use the type's default value (e.g. 0) instead of null when dealing with non-numeric data.
- 759da7a: Support multiple OTEL metric types in source configuration setup.

### Patch Changes

- c60b975: chore: bump node to v22.16.0
- 50ce38f: Histogram metric query test cases
- 9004826: fix: remove total number of webhook limit
- 2e350e2: feat: implement logs > metrics correlation flow + introduce convertV1ChartConfigToV2
- 321e24f: fix: alerting time range filtering bug
- 9a9581b: Adds external API for alerts and dashboards
- e5dfefb: Added test cases for the webhook and source routes.
- fa7875c: feat: add summary and exponential histogram metrics to the source form and database storage
- f5e9a07: chore: bump node version to v22
- 59ee6d2: bring usage stats up to date
- 1674ab8: moved swagger to dependencies instead of devDependencies
- 86465a2: fix: map CLICKHOUSE_SERVER_ENDPOINT to otelcol ch exporter 'endpoint' field
- d72d1d2: Add ingestion key authentication in OTel collector via OpAMP
- b9f7d32: Refactored renderWith to simplify logic and ship more tests with the changes.
- 293a2af: Adds openapidoc annotations for spec generation and swagger route for development
- 92a4800: feat: move rrweb event fetching to the client instead of an api route
- adc2a0b: fix: Ensure errors from proxy are shown to the user
- 43a9ca1: adopt clickhouse-js for all client side queries
- 7f0b397: feat: queryChartConfig method + events chart ratio
- 5db2767: Fixed CI linting and UI release task.
- 000458d: chore: GA v2
- 99b60d5: Fixed sum metric query to pass integration test case from v1.
- 931d738: fix: bugs with showing non otel spans (ex. clickhouse opentelemetry span logs)
- 184402d: fix: use quote for aliases for sql compatibility
- cd0e4fd: fix: correct handling of gauge metrics in renderChartConfig
- d63deed: fix: support otelcol opamp for aio build
- b4b5f6b: style: remove unused routes/components + clickhouse utils (api)
- e7262d1: feat: introduce all-one-one (auth vs noauth) multi-stage build
- d326610: feat: introduce RUN_SCHEDULED_TASKS_EXTERNALLY + enable in-app task
- 96b8c50: Fix histogram query metric to support grouping and correct issues with value computation.
- 414ff92: perf + fix: single clickhouse proxy middleware instance
- Updated dependencies [50ce38f]
- Updated dependencies [79fe30f]
- Updated dependencies [e935bb6]
- Updated dependencies [8acc725]
- Updated dependencies [2e350e2]
- Updated dependencies [321e24f]
- Updated dependencies [092a292]
- Updated dependencies [a6fd5e3]
- Updated dependencies [2f626e1]
- Updated dependencies [cfdd523]
- Updated dependencies [9c5c239]
- Updated dependencies [7d2cfcf]
- Updated dependencies [a9dfa14]
- Updated dependencies [fa7875c]
- Updated dependencies [b16c8e1]
- Updated dependencies [c50c42d]
- Updated dependencies [86465a2]
- Updated dependencies [e002c2f]
- Updated dependencies [b51e39c]
- Updated dependencies [759da7a]
- Updated dependencies [b9f7d32]
- Updated dependencies [92a4800]
- Updated dependencies [eaa6bfa]
- Updated dependencies [e80630c]
- Updated dependencies [4865ce7]
- Updated dependencies [29e8f37]
- Updated dependencies [43a9ca1]
- Updated dependencies [7f0b397]
- Updated dependencies [bd9dc18]
- Updated dependencies [5db2767]
- Updated dependencies [414ff92]
- Updated dependencies [000458d]
- Updated dependencies [0cf5358]
- Updated dependencies [99b60d5]
- Updated dependencies [931d738]
- Updated dependencies [57a6bc3]
- Updated dependencies [184402d]
- Updated dependencies [a762203]
- Updated dependencies [cd0e4fd]
- Updated dependencies [e7262d1]
- Updated dependencies [321e24f]
- Updated dependencies [96b8c50]
- Updated dependencies [e884d85]
- Updated dependencies [e5a210a]
  - @hyperdx/common-utils@0.2.0

## 2.0.0-beta.17

### Patch Changes

- c60b975: chore: bump node to v22.16.0
- 9004826: fix: remove total number of webhook limit
- 321e24f: fix: alerting time range filtering bug
- fa7875c: feat: add summary and exponential histogram metrics to the source form and database storage
- 59ee6d2: bring usage stats up to date
- 86465a2: fix: map CLICKHOUSE_SERVER_ENDPOINT to otelcol ch exporter 'endpoint' field
- d72d1d2: Add ingestion key authentication in OTel collector via OpAMP
- 43a9ca1: adopt clickhouse-js for all client side queries
- d63deed: fix: support otelcol opamp for aio build
- e7262d1: feat: introduce all-one-one (auth vs noauth) multi-stage build
- 96b8c50: Fix histogram query metric to support grouping and correct issues with value computation.
- Updated dependencies [e935bb6]
- Updated dependencies [321e24f]
- Updated dependencies [7d2cfcf]
- Updated dependencies [fa7875c]
- Updated dependencies [86465a2]
- Updated dependencies [b51e39c]
- Updated dependencies [43a9ca1]
- Updated dependencies [0cf5358]
- Updated dependencies [a762203]
- Updated dependencies [e7262d1]
- Updated dependencies [321e24f]
- Updated dependencies [96b8c50]
  - @hyperdx/common-utils@0.2.0-beta.6

## 2.0.0-beta.16

### Patch Changes

- 1674ab8: moved swagger to dependencies instead of devDependencies
- 931d738: fix: bugs with showing non otel spans (ex. clickhouse opentelemetry span logs)
- Updated dependencies [931d738]
  - @hyperdx/common-utils@0.2.0-beta.5

## 2.0.0-beta.15

### Minor Changes

- 79fe30f: Queries depending on numeric aggregates now use the type's default value (e.g. 0) instead of null when dealing with non-numeric data.

### Patch Changes

- 9a9581b: Adds external API for alerts and dashboards
- 293a2af: Adds openapidoc annotations for spec generation and swagger route for development
- 92a4800: feat: move rrweb event fetching to the client instead of an api route
- 7f0b397: feat: queryChartConfig method + events chart ratio
- b4b5f6b: style: remove unused routes/components + clickhouse utils (api)
- Updated dependencies [79fe30f]
- Updated dependencies [cfdd523]
- Updated dependencies [92a4800]
- Updated dependencies [7f0b397]
  - @hyperdx/common-utils@0.2.0-beta.4

## 2.0.0-beta.14

### Patch Changes

- e5dfefb: Added test cases for the webhook and source routes.
- f5e9a07: chore: bump node version to v22
- Updated dependencies [092a292]
- Updated dependencies [2f626e1]
- Updated dependencies [b16c8e1]
- Updated dependencies [4865ce7]
  - @hyperdx/common-utils@0.2.0-beta.3

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
