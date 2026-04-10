# @hyperdx/cli — Development Guide

## Prerequisites

- **Node.js** >= 22.16.0
- **Yarn** 4 (workspace managed from monorepo root)
- **Bun** (optional, for standalone binary compilation)
- A running HyperDX instance (API server or Next.js frontend with proxy)

## Getting Started

```bash
# From the monorepo root
yarn install

# Navigate to the CLI package
cd packages/cli
```

### Authentication

Before using the TUI, authenticate with your HyperDX instance:

```bash
# Interactive login (opens email/password prompts)
yarn dev auth login -s http://localhost:8000

# Non-interactive login (for scripting/CI)
yarn dev auth login -s http://localhost:8000 -e user@example.com -p password

# Verify auth status
yarn dev auth status

# Session is saved to ~/.config/hyperdx/cli/session.json
```

Once authenticated, the `-s` flag is optional — the CLI reads the server URL
from the saved session.

### Running in Dev Mode

`yarn dev` uses `tsx` for direct TypeScript execution — no compile step needed.

```bash
# Interactive TUI
yarn dev tui

# With explicit server URL
yarn dev tui -s http://localhost:8000

# Skip source picker
yarn dev tui --source "Logs"

# Start with a search query + follow mode
yarn dev tui -q "level:error" -f

# Non-interactive streaming
yarn dev stream --source "Logs"

# List available sources
yarn dev sources

```

## Building & Compiling

```bash
# Type check (no output on success)
npx tsc --noEmit

# Bundle with tsup (outputs to dist/cli.js)
yarn build

# Compile standalone binary for current platform
yarn compile

# Cross-compile
yarn compile:macos        # macOS ARM64
yarn compile:macos-x64    # macOS x64
yarn compile:linux         # Linux x64
```

The compiled binary is a single file at `dist/hdx` (or `dist/hdx-<platform>`).

## Project Structure

```
src/
├── cli.tsx                # Entry point — Commander CLI commands
│                          # (tui, stream, sources, auth login/logout/status)
│                          # Also contains LoginPrompt component
├── App.tsx                # Ink app shell — state machine:
│                          # loading → login → pick-source → EventViewer
├── api/
│   ├── client.ts          # ApiClient (REST + session cookies)
│   │                      # ProxyClickhouseClient (ClickHouse via /clickhouse-proxy)
│   └── eventQuery.ts      # Query builders:
│                          #   buildEventSearchQuery — table view (uses renderChartConfig)
│                          #   buildTraceSpansSql — waterfall trace spans
│                          #   buildTraceLogsSql — waterfall correlated logs
│                          #   buildFullRowQuery — SELECT * for row detail (uses renderChartConfig)
├── components/
│   ├── EventViewer.tsx    # Main TUI view (~1275 lines)
│   │                      # Table, search, detail panel with 3 tabs
│   ├── TraceWaterfall.tsx # Trace waterfall chart with j/k navigation
│   ├── RowOverview.tsx    # Structured overview (Top Level, Attributes, Resources)
│   ├── ColumnValues.tsx   # Shared key-value renderer with scroll support
│   ├── LoginForm.tsx      # Email/password login form (used inside TUI App)
│   ├── SourcePicker.tsx   # j/k source selector
│   └── Spotlight.tsx      # Ctrl+K spotlight overlay for quick navigation
├── shared/                # Logic ported from packages/app (@source annotated)
│   ├── useRowWhere.ts     # processRowToWhereClause, buildColumnMap, getRowWhere
│   ├── source.ts          # getDisplayedTimestampValueExpression, getEventBody, etc.
│   └── rowDataPanel.ts    # ROW_DATA_ALIASES, buildRowDataSelectList
└── utils/
    ├── config.ts          # Session persistence (~/.config/hyperdx/cli/session.json)
    ├── editor.ts          # $EDITOR integration for time range and SELECT editing
    └── silenceLogs.ts     # Suppresses console.debug/warn/error, verbose file logging
```

## Data Flow

### Table View Query

```
User types search → buildEventSearchQuery()
  → renderChartConfig() from @hyperdx/common-utils
  → ProxyClickhouseClient.query()
  → API /clickhouse-proxy → ClickHouse
  → JSON response with { data, meta }
  → Store chSql in lastTableChSqlRef, meta in lastTableMetaRef
  → Render dynamic table columns from row keys
```

### Row Detail Fetch (on Enter/l)

```
User expands row → buildFullRowQuery()
  → chSqlToAliasMap(lastTableChSql) for alias resolution
  → buildColumnMap(lastTableMeta, aliasMap) for type-aware WHERE
  → processRowToWhereClause() with proper type handling
  → renderChartConfig() with SELECT *, __hdx_* aliases
  → Results include LogAttributes, ResourceAttributes, etc.
```

### Trace Waterfall

```
User switches to Trace tab
  → buildTraceSpansSql() — fetch spans by TraceId
  → buildTraceLogsSql() — fetch correlated logs by TraceId (if logSource exists)
  → buildTree() — single-pass DAG builder (port of DBTraceWaterfallChart)
  → Render waterfall with timing bars
  → j/k navigation highlights spans, fetches SELECT * for Event Details
```

### ClickHouse Proxy Client

`ProxyClickhouseClient` extends `BaseClickhouseClient` from common-utils:

- Derives proxy pathname from API URL (e.g. `/api/clickhouse-proxy` for Next.js
  proxy, `/clickhouse-proxy` for direct API)
- Passes `origin` only to `createClient` (not the path, which ClickHouse client
  would interpret as a database name)
- Injects session cookies + `x-hyperdx-connection-id` header
- Forces `content-type: text/plain` to prevent Express body parser issues

### Server URL Resolution

The `-s` flag is optional on most commands. Resolution order:

1. Explicit `-s <url>` flag
2. Saved session's `apiUrl` from `~/.config/hyperdx/cli/session.json`
3. Error: "No server specified"

## Key Patterns

### useInput Handler Ordering

The `useInput` callback in EventViewer has a strict priority order. **Do not
reorder these checks**:

1. `?` toggles help (except when search focused)
2. Any key closes help when showing
3. SQL preview — D/Esc close, Ctrl+D/U scroll
4. `Ctrl+K` — opens spotlight (quick navigation)
5. `focusDetailSearch` — consumes all keys except Esc/Enter
6. `focusSearch` — consumes all keys except Tab/Esc
7. Trace tab j/k + Ctrl+D/U — when detail panel open and Trace tab active
8. Column Values / Overview Ctrl+D/U — scroll detail view
9. General j/k, G/g, Enter/Esc, Tab, etc.
10. Single-key shortcuts: `w`, `f`, `/`, `s`, `t`, `q`

### Follow Mode

- Enabled by default on startup
- Slides `timeRange` forward every 2s via `setInterval`, triggering a replace
  fetch
- **Paused** when detail panel opens (`wasFollowingRef` saves previous state)
- **Restored** when detail panel closes

### Custom Select Per Source

`customSelectMap: Record<string, string>` stores custom SELECT overrides keyed
by `source.id`. Each source remembers its own custom select independently. Press
`s` to open `$EDITOR` with the current SELECT clause.

### Scrollable Detail Panels

All detail tabs have fixed-height viewports with Ctrl+D/U scrolling:

- **Overview / Column Values** — Uses `fullDetailMaxRows` (full screen minus
  overhead)
- **Trace Event Details** — Uses `detailMaxRows` (1/3 of terminal, since
  waterfall takes the rest)

## Web Frontend Alignment

This package ports several web frontend components. **Always check the
corresponding web component before making changes**:

| CLI Component    | Web Component           | Notes                         |
| ---------------- | ----------------------- | ----------------------------- |
| `TraceWaterfall` | `DBTraceWaterfallChart` | Tree builder is a direct port |
| `RowOverview`    | `DBRowOverviewPanel`    | Same sections and field list  |
| Trace tab logic  | `DBTracePanel`          | Source resolution (trace/log) |
| Detail panel     | `DBRowSidePanel`        | Tab structure, highlight hint |
| Row WHERE clause | `useRowWhere.tsx`       | processRowToWhereClause       |
| Row data fetch   | `DBRowDataPanel`        | ROW_DATA_ALIASES, SELECT list |
| Source helpers   | `source.ts`             | Expression getters            |

### Shared Modules (`src/shared/`)

Files in `src/shared/` are copied from `packages/app` with `@source` annotations
at the top of each file. These are candidates for future extraction to
`@hyperdx/common-utils`:

```typescript
/**
 * Row WHERE clause builder.
 *
 * @source packages/app/src/hooks/useRowWhere.tsx
 */
```

When updating these files, check the original source in `packages/app` first.

## Common Tasks

### Adding a New Keybinding

1. Add the key handler in `EventViewer.tsx`'s `useInput` callback at the correct
   priority level
2. Update the `HelpScreen` component's key list
3. Update `AGENTS.md` keybindings table
4. Update `README.md` keybindings table

### Adding a New Detail Tab

1. Add the tab key to the `detailTab` union type in `EventViewer.tsx`
2. Add the tab to the `tabs` array in the Tab key handler
3. Add the tab to the tab bar rendering
4. Add the tab content rendering block
5. Handle any tab-specific Ctrl+D/U scrolling

### Adding a New CLI Command

1. Add the command in `cli.tsx` using Commander
2. Use `resolveServer(opts.server)` for server URL resolution
3. Use `withVerbose()` if the command needs `--verbose` support
4. Update `README.md` and `AGENTS.md` with the new command

### Porting a Web Frontend Component

1. Create the file in `src/shared/` (if pure logic) or `src/components/` (if UI)
2. Add `@source packages/app/src/...` annotation at the top
3. Use `SourceResponse` type from `@/api/client` instead of `TSource` types
4. Replace React hooks with plain functions where possible (for non-React usage)
5. Add the mapping to the "Web Frontend Alignment" table in `AGENTS.md`

## Troubleshooting

### "Not logged in" error

Run `yarn dev auth login -s <url>` to authenticate. The session may have expired
or the server URL may have changed.

### HTML response instead of JSON

The API URL may be pointing to the Next.js frontend instead of the Express API
server. Both work — the CLI auto-detects the `/api` prefix in the URL and
adjusts the ClickHouse proxy path accordingly.

### "Database api does not exist"

The `ProxyClickhouseClient` was sending the URL path as a database name. This
was fixed by passing `origin` only (without path) to `createClient`.

### Row detail shows partial data

The `SELECT *` row detail fetch requires:

1. `lastTableChSqlRef` — the rendered SQL from the last table query (for
   `chSqlToAliasMap`)
2. `lastTableMetaRef` — column metadata from the query response (for type-aware
   WHERE clause)

If these are null (e.g. first render before any query), the fetch may fail
silently and fall back to the partial table row data.
