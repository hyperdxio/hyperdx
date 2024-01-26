# @hyperdx/app

## 1.6.0

### Minor Changes

- ac667cd: Add Spotlight

### Patch Changes

- 82640b0: feat: implement histogram linear interpolation quantile function
- 8de2c5c: fix: handle py span ids
- 5d02cc3: Group saved searches and dashboards by tag
- 8de2c5c: feat: parse lambda json message
- 8919179: fix: Fixed parsing && and || operators in queries correctly
- cbdbe72: AppNav improvements
- 6321d1f: feat: support jk key bindings (to move through events)
- e92bf4f: fix: convert fixed minute unit granularity to Granularity enum
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
- f618e02: Add CPU and Mem charts to Infra dashboard (with mock api)
- 4ee544c: Fix: Don't crash line chart when rendering numerical group values
- 725d7b7: 🔔 Introduces new alerts management page
- 9e617ed: ci: setup aggregator int tests
- 5f05081: feat: api to pull service + k8s attrs linkings
- dc88a59: fix: add db.normalized_statement default value
- ea9acde: Add Pods table to Infra dashboard
- 3e885bf: fix: move span k8s tags to root
- bfb08f8: perf: add index for pulling alert histories (GET alerts endpoint)
- 1b4607b: fix: services endpoint should return empty array if no custom fields
  found
- 8815eff: Placeholder page for Service Dashboard
- 08b06fa: Hide appnav banner when collapsed
- 95ddbb8: fix: services endpoint bug (missing log lines results in no matches)
- 76d7d73: fix: GET alerts endpoint

## 1.4.0

### Minor Changes

- 24afb09: Introduce Mantine.dev v6 Component Library
- 3b8effe: Add specifying multiple series of charts for time/line charts and
  tables in dashboard (ex. min, max, avg all in one chart).
- 60ee49a: Overhaul Properties viewer

### Patch Changes

- 9dc7750: fix: extend level inference scanning range
- 6d3cdae: Fix table chart link query formatting
- f65dd9b: Loading and error states for metrics dropdown
- af70f7d: Link Infrastructure Metrics with Events
- 8d1a949: perf: disable metrics property type mapping caching
- 423fc22: perf + feat: introduce SimpleCache and specify getMetricsTags time
  range
- 5e37a94: Allow to customize number formats in dashboard charts
- 807736c: Fix Headers parsing in Log Details
- 5b3b256: Show save badge in Dashboard page
- 72164a6: Limit Line Chart legend items
- 70f5fc4: Alerts page styling
- 58d928c: feat: transform k8s event semantic conventions
- 8159a01: Add K8s event tags
- ea20a79: Update Line Chart tooltip styling
- df7cfdf: Add new Legend renderer to MultiSeries chart
- b8133eb: feat: allow users to specify 'service.name' attr (flyio)
- 6efca13: Use Popover instead of Tooltip for line chart overflow

## 1.3.0

### Minor Changes

- ff38d75: feat: extract and ingest more metrics context (aggregation
  temporality, unit and monotonicity)
- 6f2c75e: refactor: split metrics chart endpoint `name` query param into `type`
  and `name` params (changing an internal API) feat: add validation for metrics
  chart endpoint using zod
- 8c8c476: feat: add is_delta + is_monotonic fields to metric_stream table
  (REQUIRES DB MIGRATION)
- 20b1f17: feat: external api v1 route (REQUIRES db migration) + Mongo DB
  migration script
- 9c2e279: feat: Log Side Panel styling
- e8c26d8: feat: time format ui addition

### Patch Changes

- ddd4867: Set up Storybook
- ddd4867: Sentry exceptions ui improvements
- 3a93196: Fix Sentry exception rendering error in side panel, add Sentry SDK to
  API server.
- a40faf1: Allow to set alerts for metric charts on development env
- f205ed5: feat: Add Sentry Integration section to Team Settings
- 2be709c: Revert adding Storybook
- 8c8c476: feat: setup clickhouse migration tool
- 77c1019: Show chart alert state (OK and ALERT)
- 4c0617e: Fix: Vertically resize session replayer
- 7784921: Fix: Don't crash session replay player when playback timestamp is not
  a valid date
- 242d8cc: Show custom actions in Session Replay events panel
- 713537d: Click on Table Tile to view all events
- 58a19fd: Set up ESLint rule for sorting imports
- abe3b12: Log Side Panel: exceptions ui improvements

## 1.2.0

### Minor Changes

- fe41b15: feat: Add dashboard delete confirmations and duplicate chart button
- bbda669: Chart alerts: add schemas and read path
- bf8af29: feat: Toggle columns from LogSidePanel
- 04f82d7: LogTable and LogSidePanel UI tweaks
- 0824ae7: API: Add support for chart alerts
- b1a537d: feat(register): password confirmation
- 8443a08: feat: implement CHART source alert (scheduled task)
- 283f32a: Chart alerts: connect UI to API
- 7d636f2: feat: enhanced registration form validation

### Patch Changes

- 9a72b85: fix: getLogBatchGroupedByBody missing return bug (regression)
- 956e5b5: chore: bump vector to v0.34.0
- 2fcd167: Chart alerts: Add UI to chart builder
- 640a5ba: fix: Chart alert default interval
- e904ec3: Refactor: Extract shared alert logic into a separate component

## 1.1.4

### Patch Changes

- 8cb0eac: Add rate function for sum metrics
- 4d24bfa: Add new version of the useTimeQuery hook along with a testing suite
- 8591aee: fix: control otel related services logs telemetry using
  HYPERDX_LOG_LEVEL

## 1.1.3

### Patch Changes

- 389bb3a: feat: support HYPERDX_LOG_LEVEL env var
- e106b75: style(ui): improve duration column representation
- 1ec122c: fix: aggregator errors handler status code
- 40ba7bb: enhancement - Persist log table column sizes to local storage

## 1.1.2

### Patch Changes

- bd37a5e: Filter out empty session replays from session replay search, add
  email filter to session replay UI
- 5d005f7: chore: bump @hyperdx/node-opentelemetry + @hyperdx/browser to latest
- 8b103f3: fix(app): negative duration in search

  Duration column in the search interface displayed negative numbers when only a
  timestamp was present. This fix changes the behavior to display "N/A" for such
  cases, clarifying that the duration is not applicable rather than displaying a
  misleading negative number.

- 911c02a: feat(app): enable cursor in session player
- 593c4ca: refactor: set output datetime format on the client side

## 1.1.1

### Patch Changes

- chore: bump @hyperdx/node-logger + @hyperdx/node-opentelemetry

## 1.1.0

### Minor Changes

- 914d49a: feat: introduce usage-stats service
