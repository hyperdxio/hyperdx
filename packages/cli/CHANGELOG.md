# @hyperdx/cli

## 0.2.1

### Patch Changes

- bdca9bd4: Improve error message rendering with visible highlighting and add SQL preview

  - Add ErrorDisplay component with bordered boxes, color-coded severity, and responsive terminal height adaptation
  - Preserve ClickHouseQueryError objects through the error chain to show sent query context
  - Surface previously silent errors: pagination failures, row detail fetch errors, trace span detail errors
  - Add Shift-D keybinding to view generated ClickHouse SQL (context-aware across all tabs)
  - Copy useSqlSuggestions from app package to detect common query mistakes
  - Disable follow mode toggle in event detail panel

## 0.2.0

### Minor Changes

- d995b78c: Add @hyperdx/cli package — terminal CLI for searching, tailing, and inspecting logs and traces from HyperDX with interactive TUI, trace waterfall, raw SQL queries, dashboard listing, and sourcemap uploads.
