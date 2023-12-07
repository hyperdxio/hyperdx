# @hyperdx/app

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
