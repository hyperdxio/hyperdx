# @hyperdx/app

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
