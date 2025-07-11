# @hyperdx/app

## 2.0.5

### Patch Changes

- 973b9e8: feat: Add any aggFn support, fix select field input not showing up
- 844f74c: fix: validate name for saved searches
- f7eb1ef: feat: configurable search row limit
- Updated dependencies [973b9e8]
  - @hyperdx/common-utils@0.2.5

## 2.0.4

### Patch Changes

- 52ca182: feat: Add ClickHouse JSON Type Support
- Updated dependencies [52ca182]
  - @hyperdx/common-utils@0.2.4

## 2.0.3

### Patch Changes

- b75d7c0: feat: add robust source form validation and error reporting
- a06c8cd: feat: Add download csv functionality to search tables
- 93e36b5: fix: remove id from post for connection creation endpoint
- Updated dependencies [b75d7c0]
- Updated dependencies [93e36b5]
  - @hyperdx/common-utils@0.2.3

## 2.0.2

### Patch Changes

- d1f4184: perf: improve performance on chart page and search page
- 8ab3b42: fix: fix demo instances for those with stale sources
- d1fc0c7: fix: change NEXT_PUBLIC_SERVER_URL to SERVER_URL
- eb9d009: feat: DBRowSidePanel global error boundary
- 73aff77: feat: Improve source editing UX
- 31e22dc: feat: introduce clickhouse db init script
- 2063774: perf: build next app in standalone mode to cut down images size
- 86fa929: Removed duplicate type definition.
- Updated dependencies [31e22dc]
- Updated dependencies [2063774]
  - @hyperdx/common-utils@0.2.2

## 2.0.1

### Patch Changes

- ab3b5cb: perf: merge api + app packages to dedupe node_modules
- ab387e1: fix: missing types in app build
- fce5ee5: feat: add load more to features and improve querying
- dfdb2d7: Better loading state for events patterns table
- 3eeb530: fix: date range undefined error causing issue loading keyvals for autocomplete
- 8874648: fix: Pollyfill crypto.randomUUID
- 43edac8: chore: bump @hyperdx/node-opentelemetry to v0.8.2
- Updated dependencies [ab3b5cb]
- Updated dependencies [ab387e1]
- Updated dependencies [fce5ee5]
  - @hyperdx/common-utils@0.2.1

## 2.0.0

### Major Changes

- 3fb3169: bumps to v2 beta

### Minor Changes

- 759da7a: Support multiple OTEL metric types in source configuration setup.
- 9579251: Stores the collapse vs expand status of the side navigation in local storage so it's carried across browser windows/sessions.
- 57a6bc3: feat: BETA metrics support (sum + gauge)

### Patch Changes

- 56e39dc: 36c3edc fix: remove several source change forms throughout the log drawer
- c60b975: chore: bump node to v22.16.0
- ab617c1: feat: support multiseries metrics chart
- 7de8916: Removes trailing slash for connection urls
- 3be7f4d: fix: input does not overlap with language select button anymore
- d176b54: fix: chartpage querying too on every keystroke after initial query
- 459267a: feat: introduce session table model form
- fe8ed22: fix: color display on search page for traces
- b3f3151: Allow to create Slack Webhooks from Team Settings page
- 2e350e2: feat: implement logs > metrics correlation flow + introduce convertV1ChartConfigToV2
- 321e24f: fix: alerting time range filtering bug
- 092a292: fix: autocomplete for key-values complete for v2 lucene
- a6fd5e3: feat: introduce k8s preset dashboard
- 2f626e1: fix: metric name filtering for some metadata
- cfdd523: feat: clickhouse queries are by default conducted through the clickhouse library via POST request. localMode still uses GET for CORS purposes
- 6dc6989: feat: Automatically use last used source when loading search page
- a9dfa14: Added support to CTE rendering where you can now specify a CTE using a full chart config object instance. This CTE capability is then used to avoid the URI too long error for delta event queries.
- fa7875c: feat: add summary and exponential histogram metrics to the source form and database storage
- 5a10ae1: fix: delete huge z-value for tooltip
- f5e9a07: chore: bump node version to v22
- b16c8e1: feat: compute charts ratio
- 6864836: fix: don't show ellipses on search when query is in-flight
- 86465a2: fix: map CLICKHOUSE_SERVER_ENDPOINT to otelcol ch exporter 'endpoint' field
- 08009ac: feat: add saved filters for searches
- 92a4800: feat: move rrweb event fetching to the client instead of an api route
- b99236d: fix: autocomplete options for dashboard page
- 43a9ca1: adopt clickhouse-js for all client side queries
- b690db8: Introduce event panel overview tab
- 7f0b397: feat: queryChartConfig method + events chart ratio
- 5db2767: Fixed CI linting and UI release task.
- 000458d: chore: GA v2
- 84a9119: fix: Session replay intermittently showing "No replay available for this session"
- 4514f2c: Remove connection health hook - too noisy
- 8d534da: fixed ui state on session panel to be inline with ui
- 931d738: fix: bugs with showing non otel spans (ex. clickhouse opentelemetry span logs)
- 2580ddd: chore: bump next to v13.5.10
- db761ba: fix: remove originalWhere tag from view. not used anyways
- 184402d: fix: use quote for aliases for sql compatibility
- 5044083: Session Replay tab for traces is disabled unless the source is configured with a sessionId
- 8c95b9e: Add search history
- a762203: fix: metadata getAllKeyValues query key scoped to table now
- cd0e4fd: fix: correct handling of gauge metrics in renderChartConfig
- b4b5f6b: style: remove unused routes/components + clickhouse utils (api)
- 1211386: add severitytext coloring to event patterns
- 6dafb87: fix: View Events not shown for multiple series; grabs where clause when single series
- e7262d1: feat: introduce all-one-one (auth vs noauth) multi-stage build
- decd622: fix: k8s dashboard uptime metrics + warning k8s event body
- e884d85: fix: metrics > logs correlation flow
- e5a210a: feat: support search on multi implicit fields (BETA)
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
- d176b54: fix: chartpage querying too on every keystroke after initial query
- fe8ed22: fix: color display on search page for traces
- 321e24f: fix: alerting time range filtering bug
- fa7875c: feat: add summary and exponential histogram metrics to the source form and database storage
- 86465a2: fix: map CLICKHOUSE_SERVER_ENDPOINT to otelcol ch exporter 'endpoint' field
- 43a9ca1: adopt clickhouse-js for all client side queries
- 84a9119: fix: Session replay intermittently showing "No replay available for this session"
- 8d534da: fixed ui state on session panel to be inline with ui
- a762203: fix: metadata getAllKeyValues query key scoped to table now
- 1211386: add severitytext coloring to event patterns
- e7262d1: feat: introduce all-one-one (auth vs noauth) multi-stage build
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

- 931d738: fix: bugs with showing non otel spans (ex. clickhouse opentelemetry span logs)
- Updated dependencies [931d738]
  - @hyperdx/common-utils@0.2.0-beta.5

## 2.0.0-beta.15

### Patch Changes

- 7de8916: Removes trailing slash for connection urls
- cfdd523: feat: clickhouse queries are by default conducted through the clickhouse library via POST request. localMode still uses GET for CORS purposes
- 6dc6989: feat: Automatically use last used source when loading search page
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

- 56e39dc: 36c3edc fix: remove several source change forms throughout the log drawer
- 092a292: fix: autocomplete for key-values complete for v2 lucene
- 2f626e1: fix: metric name filtering for some metadata
- f5e9a07: chore: bump node version to v22
- b16c8e1: feat: compute charts ratio
- 08009ac: feat: add saved filters for searches
- db761ba: fix: remove originalWhere tag from view. not used anyways
- 8c95b9e: Add search history
- Updated dependencies [092a292]
- Updated dependencies [2f626e1]
- Updated dependencies [b16c8e1]
- Updated dependencies [4865ce7]
  - @hyperdx/common-utils@0.2.0-beta.3

## 2.0.0-beta.13

### Minor Changes

- 9579251: Stores the collapse vs expand status of the side navigation in local storage so it's carried across browser windows/sessions.

### Patch Changes

- 3be7f4d: fix: input does not overlap with language select button anymore
- 2e350e2: feat: implement logs > metrics correlation flow + introduce convertV1ChartConfigToV2
- a6fd5e3: feat: introduce k8s preset dashboard
- a9dfa14: Added support to CTE rendering where you can now specify a CTE using a full chart config object instance. This CTE capability is then used to avoid the URI too long error for delta event queries.
- 5a10ae1: fix: delete huge z-value for tooltip
- 6864836: fix: don't show ellipses on search when query is in-flight
- b99236d: fix: autocomplete options for dashboard page
- 5db2767: Fixed CI linting and UI release task.
- 2580ddd: chore: bump next to v13.5.10
- 5044083: Session Replay tab for traces is disabled unless the source is configured with a sessionId
- 6dafb87: fix: View Events not shown for multiple series; grabs where clause when single series
- decd622: fix: k8s dashboard uptime metrics + warning k8s event body
- e884d85: fix: metrics > logs correlation flow
- e5a210a: feat: support search on multi implicit fields (BETA)
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
- 57a6bc3: feat: BETA metrics support (sum + gauge)

### Patch Changes

- ab617c1: feat: support multiseries metrics chart
- 4514f2c: Remove connection health hook - too noisy
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

- 459267a: feat: introduce session table model form

## 2.0.0-beta.0

### Major Changes

- bumps to v2 beta

### Patch Changes

- b3f3151: Allow to create Slack Webhooks from Team Settings page
- b690db8: Introduce event panel overview tab

## 1.9.0

### Minor Changes

- 2488882: Allow to filter search results by event type (log or span)
- 1751b2e: Propogate isUTC and clock settings (12h/24h) across the app

### Patch Changes

- 4176710: autofocus on field select after setting a non-count aggfn
- e26a6d2: Add User Preferences modal
- 6d99e3b: New performant session replay playbar component
- ebd3f25: Reassign save search shortcut for Arc to CMD+SHIFT+S
- 25faa4d: chore: bump HyperDX SDKs (node-opentelemetry v0.8.0 + browser 0.21.0)
- ded8a77: fix: logtable scroll with highlighted line id
- 4af6802: chore: Remove unused dependencies
- 9c4f741: fix: threshold def of presence alert in alerts page
- 3b29721: Render JSON network body in a JSON viewer
- 3260f08: Allow to share open log in search dashboard tile
- da866be: fix: revisit doesExceedThreshold logic
- b192366: chore: bump node to v18.20.3
- 148c92b: perf: remove redundant otel-logs fields (timestamp + spanID +
  traceID)
- 47b758a: Confirm leaving Dashboard with unsaved changes
- 79d4f92: Hide HyperJson buttons when selecting value

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
- 05517dc: LogViewer: better JSON parsing and other tweaks
- d3e270a: chore: bump vector to v0.37.0
- ec95ef0: Add skip forward/back 15s buttons on session replay
- 2c61276: Allow exporting table chart results as CSV
- bc1e84b: Allow to interact with page while log side panel is open
- ab96e7c: Update Team Page layout and styling

## 1.7.0

### Minor Changes

- 396468c: fix: Use nuqs for ChartPage url query params

### Patch Changes

- dba8a43: Allow to drag and drop saved searches and dashhoards between groups
- 95ccfa1: Add multi-series line/table charts as well as histogram/number charts
  to the chart explorer.
- 095ec0e: fix: histogram AggFn values to be only valid ones (UI)
- 41d80de: feat: parse legacy k8s v1 cluster events
- f9521a5: Upgrade to React 18 and Next 13
- b87c4d7: fix: dense rank should be computed base on rank value and group
  (multi-series chart)
- 95f5041: Minor UI fixes
- a49726e: fix: cache the result conditionally (SimpleCache)
- b83e51f: refactor + perf: decouple and performance opt metrics tags endpoints

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
