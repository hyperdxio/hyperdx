# @hyperdx/cli

## 0.4.1

### Patch Changes

- 253cf5b7: Fix CLI version flag reporting hardcoded 0.1.0 instead of the actual package version

## 0.4.0

### Minor Changes

- 3571bfaf: Add `hdx query` and `hdx connections` commands for agentic ClickHouse workflows:

  - **`hdx connections`** — list ClickHouse connections (`id`, `name`, `host`) for the authenticated team. Supports `--json` for programmatic consumption.
  - **`hdx query --connection-id <id> --sql <query>`** — run raw SQL against a configured ClickHouse connection via the `/clickhouse-proxy`. Default `--format` is `JSONEachRow` (NDJSON); any ClickHouse format is accepted. Exit codes: `0` on success (empty stdout = zero rows), `1` on failure. On error, a lazy connection lookup distinguishes "unknown connection ID" from "bad SQL".
  - **`hdx query --patterns`** — post-process the result with the Drain algorithm (`@hyperdx/common-utils/dist/drain`) and emit one NDJSON pattern object per cluster, sorted by count desc: `{"pattern":"<template>","count":<n>,"sample":"<first sample>"}`. Use `--body-column <name>` to cluster a single column's string value; defaults to the whole row JSON-serialized so any SELECT shape works.
  - `--help` documents the exit-code contract and includes sampling guidance (`ORDER BY rand()` + selective WHERE warning) for mining over large tables.

## 0.3.0

### Minor Changes

- 4dea3621: **Breaking:** Replace `-s`/`--server` flag with `-a`/`--app-url` across all CLI commands (except `upload-sourcemaps`). Users should now provide the HyperDX app URL instead of the API URL — the CLI derives the API URL by appending `/api`.

  - `hdx auth login` now prompts interactively for login method, app URL, and credentials (no flags required)
  - Expired/missing sessions prompt for re-login with the last URL autofilled instead of printing an error
  - Add URL input validation and post-login session verification
  - Existing saved sessions are auto-migrated from `apiUrl` to `appUrl`

### Patch Changes

- 7a9882d4: Add alerts page (Shift+A) with overview and recent trigger history
- 418f70c5: Add event pattern mining view (Shift+P) with sampled estimation and drill-down
- 7953c028: feat: Add between-type alert thresholds
- fe3ab41c: Add `o` keybinding to open the current trace/span in the HyperDX web app from the TUI. Deep-links to the exact view with side panel, tab, and span selection preserved. Works for both trace and log sources.
- 07bb29e9: Optimize event detail and trace waterfall queries; add trace detail page and waterfall scrolling
- d3a61f9b: feat: Add additional alert threshold types

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
