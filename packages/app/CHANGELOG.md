# @hyperdx/app

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
