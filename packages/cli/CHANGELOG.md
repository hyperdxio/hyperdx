# @hyperdx/cli

## 0.6.0

### Minor Changes

- 386c365d: Add terminal charting to the CLI, built on the same renderChartConfig SQL
  pipeline as the web dashboards:

  - Interactive Dashboards page in the TUI (`d` key) with tile navigation,
    fullscreen tiles, time-range editing, and refresh
  - `hdx chart` command for troubleshooting from the terminal (including by
    AI agents): render saved dashboard tiles (`-d/-t`), ad-hoc builder charts
    (`-s <source>` with `--agg/--value/--where/--group-by/--series`), or ad-hoc
    raw SQL (`--sql` with `$__timeFilter`/`$__timeInterval` macros)
  - Supported chart types: line, stacked bar, number, table, bar, pie, and
    markdown; flexible time ranges (`--since 1h`, `--from now-24h`, ISO dates);
    `--json` output for structured consumption; ANSI colors auto-stripped when
    piping (`--color auto|always|never`)

### Patch Changes

- 1705b37a: fix: Block webhook URLs targeting known-bad IP ranges

## 0.5.2

### Patch Changes

- bb7ae21e8: Upgrade the TypeScript devDependency from 5.9 to 6.0 across all packages.

## 0.5.1

### Patch Changes

- 5c46215f8: Bump `@clickhouse/client*` to `1.23.0-head.fae5998.1` and fix the type
  incompatibility it introduces.

  In `@clickhouse/client*` 1.23 each platform package (`@clickhouse/client`,
  `@clickhouse/client-web`) bundles its own copy of the shared types, so their
  `ClickHouseSettings` types — which reference the nominally-compared `SettingsMap`
  class — are no longer the same type as `@clickhouse/client-common`'s. The shared
  `processClickhouseSettings()` helper produces the `client-common` flavor, so
  assigning it into the per-platform clients' `query()` now requires an explicit
  bridge. Guard the existing `as ClickHouseSettings` assertions at those
  boundaries (`node.ts`, `browser.ts`, `cli`) with a scoped
  `@typescript-eslint/no-unsafe-type-assertion` disable, matching the existing
  "client library type mismatch" pattern. No runtime behavior changes.

- 45954c318: Import ClickHouse client types from the platform packages
  (`@clickhouse/client` / `@clickhouse/client-web`) instead of the deprecated
  `@clickhouse/client-common`. This makes the packages forward-compatible with
  `@clickhouse/client*` 1.23 (where `client-common` is deprecated and each
  platform package bundles and re-exports its own copy of the shared types)
  without bumping the pinned version. No runtime behavior changes.
- 1a64796c1: Removing relative imports and using path aliases

## 0.5.0

### Minor Changes

- 3123db53: feat: experimental promql support

### Patch Changes

- b20275c9: fix(cli): exit with non-zero code when `upload-sourcemaps` fails

  The `upload-sourcemaps` command now exits with code 1 when uploads fail
  (missing source maps, pre-signed URL request failure, authentication failure,
  or any per-file upload failure after retries). Previously these failures were
  logged to stderr but the process exited cleanly with code 0, causing CI
  pipelines to treat failed uploads as successes.

- 19cd7c91: fix: only use pk and row uniqueness to look up a row
- 8810ff0f: feat: Add option for force-enabling/disabling text index support

## 0.4.1

### Patch Changes

- f6a1d021: Add support for event patterns in MCP server, reduce code duplication
- 253cf5b7: Fix CLI version flag reporting hardcoded 0.1.0 instead of the actual package version
- 41043645: feat: support multiple teams and kubectx-style team switching in the CLI

  Adds three new commands for users that belong to multiple teams (HyperDX Cloud /
  EE):

  - `hdx team list` — list every team the authenticated user belongs to, marking
    the active one
  - `hdx team current` — print the currently active team
  - `hdx team use <name-or-id>` — switch the active team (matched by team ID or
    case-insensitive name)

  The active team is persisted to `~/.config/hyperdx/cli/session.json` so the
  choice survives across CLI invocations, and the CLI now sends an `x-hdx-team`
  header on every API and ClickHouse-proxy request so the server scopes data to
  the chosen team. `hdx auth status` also surfaces the active team.

  On single-team OSS deployments these commands are effectively no-ops.

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
