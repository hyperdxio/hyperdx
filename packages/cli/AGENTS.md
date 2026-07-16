# @hyperdx/cli Development Guide

## What is @hyperdx/cli?

A terminal CLI for searching, tailing, and inspecting logs and traces from
HyperDX. It provides both an interactive TUI (built with Ink — React for
terminals) and a non-interactive streaming mode for piping.

The CLI connects to the HyperDX API server and queries ClickHouse directly
through the API's `/clickhouse-proxy` endpoint, using the same query generation
logic (`@hyperdx/common-utils`) as the web frontend.

## CLI Commands

```
hdx tui -s <url>                    # Interactive TUI (main command)
hdx stream -s <url> --source "Logs" # Non-interactive streaming to stdout
hdx sources -s <url>                # List available sources
hdx connections                     # List ClickHouse connections (id, name, host)
hdx dashboards                      # List dashboards with tile summaries
hdx chart -d <dashboard> [-t tile]  # Render dashboard tiles as ANSI charts
hdx chart -s <source> [--agg ...]   # Ad-hoc chart over a source (builder mode)
hdx chart --sql <query> -s <source> # Ad-hoc chart from raw SQL
hdx auth login -s <url>             # Sign in (interactive or -e/-p flags)
hdx auth status                     # Show auth status (reads saved session)
hdx auth logout                     # Clear saved session
hdx team list                       # List teams the user belongs to (multi-team)
hdx team current                    # Show the active team
hdx team use <name|id>              # Switch the active team (kubectx-style)
```

The `-s, --server <url>` flag is required for commands that talk to the API. If
omitted, the CLI falls back to the server URL saved in the session file from a
previous `hdx auth login`.

## Architecture

```
src/
├── cli.tsx              # Entry point — Commander CLI with commands:
│                        #   tui, stream, sources, auth (login/logout/status)
│                        #   Also contains the standalone LoginPrompt component
├── App.tsx              # App shell — state machine:
│                        #   loading → login → pick-source → EventViewer
├── api/
│   ├── client.ts        # ApiClient (REST + session cookies)
│   │                    # ProxyClickhouseClient (routes through /clickhouse-proxy)
│   └── eventQuery.ts    # Query builders:
│                        #   buildEventSearchQuery (table view, uses renderChartConfig)
│                        #   buildTraceSpansSql (waterfall trace spans)
│                        #   buildTraceLogsSql (waterfall correlated logs)
│                        #   buildFullRowSql (SELECT * for row detail)
├── components/
│   ├── AlertsPage.tsx   # Alerts overview page — list + detail with recent history (Shift+A)
│   ├── DashboardPage.tsx # Dashboards page — picker + tile chart view (d)
│   ├── Tile/            # Dashboard tile charting (mirror of web Tile component)
│   │   ├── TileChart.tsx  # Ink wrapper: query + render per displayType
│   │   └── useTileData.ts # React hook around shared/tileQuery fetchTileData
│   ├── EventViewer.tsx  # Main TUI view — table, search, detail panel with tabs
│   ├── TraceWaterfall.tsx # Trace waterfall chart with j/k navigation + event details
│   ├── RowOverview.tsx  # Structured overview (top-level attrs, event attrs, resource attrs)
│   ├── ColumnValues.tsx # Shared key-value renderer (used by Column Values tab + Event Details)
│   ├── LoginForm.tsx    # Email/password login form (used inside TUI App)
│   └── SourcePicker.tsx # Arrow-key source selector
├── shared/
│   ├── tileConfig.ts    # Tile → queryable chart config resolution + per-displayType
│   │                    #   transforms (ports of web DBDashboardPage / ChartUtils)
│   ├── tileQuery.ts     # fetchTileData — executes via queryChartConfig (renderChartConfig)
│   ├── tileRender.ts    # displayType → ANSI string dispatch (mirror of renderChartContent)
│   ├── chartData.ts     # Response shaping (formatResponseForTimeChart etc. ports)
│   ├── ansiChart.ts     # Pure ANSI renderers: line (asciichart), stacked bar, table,
│   │                    #   categorical bars (bar/pie), number, markdown
│   └── formatNumber.ts  # numbro-based formatNumber + number-format resolution ports
└── utils/
    ├── config.ts        # Session persistence (~/.config/hyperdx/cli/session.json)
    ├── editor.ts        # $EDITOR integration for time range and select clause editing
    └── silenceLogs.ts   # Suppresses console.debug/warn/error from common-utils
```

## Key Components

### EventViewer (`components/EventViewer.tsx`)

The main TUI component (~1100 lines). Handles:

- **Table view**: Dynamic columns derived from query results, percentage-based
  widths, `overflowX="hidden"` for truncation
- **Search**: Lucene query via `/` key, submits on Enter
- **Follow mode**: Slides time range forward every 2s, pauses when detail panel
  is open, restores on close
- **Detail panel**: Three tabs (Overview / Column Values / Trace), cycled via
  Tab key. Detail search via `/` filters content within the active tab.
- **Select editor**: `s` key opens `$EDITOR` with the current SELECT clause.
  Custom selects are stored per source ID.
- **State management**: ~20 `useState` hooks. Key states include `events`,
  `expandedRow`, `detailTab`, `isFollowing`, `customSelectMap`,
  `traceSelectedIndex`.

### TraceWaterfall (`components/TraceWaterfall.tsx`)

Port of the web frontend's `DBTraceWaterfallChart`. Key details:

- **Tree building**: Single-pass DAG builder over time-sorted rows. Direct port
  of the web frontend's logic — do NOT modify without checking
  `DBTraceWaterfallChart` first.
- **Correlated logs**: Fetches log events via `buildTraceLogsSql` and merges
  them into the span tree (logs attach as children of the span with matching
  SpanId, using `SpanId-log` suffix to avoid key collisions).
- **j/k navigation**: `selectedIndex` + `onSelectedIndexChange` props controlled
  by EventViewer. `effectiveIndex` falls back to `highlightHint` when no j/k
  navigation has occurred.
- **Event Details**: `SELECT *` fetch for the selected span/log, rendered via
  the shared `ColumnValues` component. Uses stable scalar deps
  (`selectedNodeSpanId`, `selectedNodeTimestamp`, `selectedNodeKind`) to avoid
  infinite re-fetch loops.
- **Duration formatting**: Dynamic units — `1.2s`, `3.5ms`, `45.2μs`, `123ns`.
- **Highlight**: `inverse` on label and duration text for the selected row. Bar
  color unchanged.

### RowOverview (`components/RowOverview.tsx`)

Port of the web frontend's `DBRowOverviewPanel`. Three sections:

1. **Top Level Attributes**: Standard OTel fields (TraceId, SpanId, SpanName,
   ServiceName, Duration, StatusCode, etc.)
2. **Span/Log Attributes**: Flattened from `source.eventAttributesExpression`,
   shown with key count header
3. **Resource Attributes**: Flattened from
   `source.resourceAttributesExpression`, rendered as chips with
   `backgroundColor="#3a3a3a"` and cyan key / white value

### DashboardPage + Tile charting (`components/DashboardPage.tsx`, `components/Tile/`)

Dashboard tiles are queried and rendered with the **same SQL pipeline as the
web dashboard**:

1. `shared/tileConfig.ts` resolves a tile's `SavedChartConfig` against its
   source (port of the web Tile's `queriedConfig` effect in
   `DBDashboardPage.tsx`) and applies the per-displayType config transform
   (`convertToTimeChartConfig` / `convertToNumberChartConfig` /
   `convertToTableChartConfig` / `convertToCategoricalChartConfig`).
2. `shared/tileQuery.ts` executes it via
   `clickhouseClient.queryChartConfig()` from common-utils — internally
   `setChartSelectsAlias → splitChartConfigs → renderChartConfig`, identical
   to the web's `useQueriedChartConfig` core (minus chunking / MV
   optimization / PromQL).
3. `shared/chartData.ts` shapes the response (ports of
   `formatResponseForTimeChart`, `formatResponseForCategoricalChart`, etc.).
4. `shared/ansiChart.ts` renders pure ANSI strings, consumed by both the Ink
   `TileChart` component and the non-interactive `hdx chart` command.

Supported display types: line, stacked_bar, number, table, bar, pie,
markdown. Heatmap / search / event patterns / PromQL show a placeholder.
The web's previous-period comparison overlay is not rendered; tiles with
`compareToPreviousPeriod` set show a dim callout instead.
Time-series charts stretch to the full terminal width via peak-preserving
resampling (`resampleSeries`): bucket values are placed exactly at their
nearest column (upscale) or each column keeps its bucket range's
max-magnitude value (downscale) — plain linear interpolation would sample
*between* buckets and attenuate narrow spikes. Stacked bars map columns to
buckets nearest-neighbor (upscale) or by max-total bucket (downscale).
Auto granularity is capped at 80 buckets like the web (`maxTimeBuckets`).
Y-axes use "nice" tick domains (`niceTicks`, steps of 1/2/2.5/5×10ⁿ,
zero-pinned, max rounded up) with sparse tick-row labels — mirroring the
web's recharts `domain={[0, 'auto']}` axis rather than labeling every row
with raw range fractions.

The `hdx chart` command (designed for agent-driven troubleshooting) reuses
this same pipeline in three modes: dashboard tiles (`-d`), ad-hoc builder
charts (`-s <source>` + `--agg/--value/--where/--group-by/--series`, built
by `shared/adhocChart.ts`), and ad-hoc raw SQL (`--sql` with
`$__timeFilter` / `$__timeInterval` macros). ANSI colors are stripped
automatically when stdout is not a TTY (`--color auto|always|never`), and
`--json` emits raw rows + column metadata.

Do NOT change resolution/shaping rules without checking the web components
first (see the alignment table below).

### ColumnValues (`components/ColumnValues.tsx`)

Shared component for rendering key-value pairs from a row data object. Used by:

- Column Values tab in the detail panel
- Event Details section in the Trace tab's waterfall

Supports `searchQuery` filtering and `wrapLines` toggle.

## Web Frontend Alignment

This package mirrors several web frontend components. **Always check the
corresponding web component before making changes** to ensure behavior stays
consistent:

| CLI Component          | Web Component                     | Notes                              |
| ---------------------- | --------------------------------- | ---------------------------------- |
| `TraceWaterfall`       | `DBTraceWaterfallChart`           | Tree builder is a direct port      |
| `RowOverview`          | `DBRowOverviewPanel`              | Same sections and field list       |
| Trace tab logic        | `DBTracePanel`                    | Source resolution (trace/log)      |
| Detail panel           | `DBRowSidePanel`                  | Tab structure, highlight hint      |
| Event query            | `DBTraceWaterfallChart`           | `getConfig()` → `buildTrace*Sql`   |
| `shared/tileConfig`    | `DBDashboardPage` + `ChartUtils`  | Tile config resolution/transforms  |
| `shared/tileRender`    | `DBDashboardPage`                 | `renderChartContent` dispatch      |
| `shared/chartData`     | `ChartUtils`                      | Response shaping ports             |
| `shared/formatNumber`  | `utils.ts` + `source.ts`          | formatNumber + format resolution   |

Key expression mappings from the web frontend's `getConfig()`:

- `Timestamp` → `displayedTimestampValueExpression` (NOT
  `timestampValueExpression`)
- `Duration` → `durationExpression` (raw, not seconds like web frontend)
- `Body` → `bodyExpression` (logs) or `spanNameExpression` (traces)
- `SpanId` → `spanIdExpression`
- `ParentSpanId` → `parentSpanIdExpression` (traces only)

## Keybindings (TUI mode)

| Key           | Action                                     |
| ------------- | ------------------------------------------ |
| `j` / `↓`     | Move selection down                        |
| `k` / `↑`     | Move selection up                          |
| `l` / `Enter` | Expand row detail                          |
| `h` / `Esc`   | Close detail / blur search                 |
| `G`           | Jump to newest                             |
| `g`           | Jump to oldest                             |
| `/`           | Search (global in table, filter in detail) |
| `Tab`         | Cycle sources/searches or detail tabs      |
| `Shift+Tab`   | Cycle backwards                            |
| `s`           | Edit SELECT clause in $EDITOR              |
| `t`           | Edit time range in $EDITOR                 |
| `f`           | Toggle follow mode (live tail)             |
| `o`           | Open trace in browser (detail panel)       |
| `w`           | Toggle line wrap                           |
| `A` (Shift+A) | Open alerts page                           |
| `d`           | Open dashboards page                       |
| `?`           | Toggle help screen                         |
| `q`           | Quit                                       |

In the **Trace tab**, `j`/`k` navigate spans/logs in the waterfall instead of
the main table.

In the **Dashboards page**: `j`/`k` select a tile, `Enter`/`l` opens the tile
fullscreen, `t` edits the time range in `$EDITOR`, `r` refetches all tiles,
`Esc`/`h` goes back (fullscreen → tile list → dashboard picker → previous
screen).

## Development

```bash
# Run in dev mode (tsx, no compile step)
cd packages/cli
yarn dev tui -s http://localhost:8000

# Type check
npx tsc --noEmit

# Bundle with tsup
yarn build

# Compile standalone binary (current platform)
yarn compile

# Cross-compile
yarn compile:macos        # macOS ARM64
yarn compile:macos-x64    # macOS x64
yarn compile:linux        # Linux x64
```

## Key Patterns

### Session Management

Session is stored at `~/.config/hyperdx/cli/session.json` with mode `0o600`.
Contains `apiUrl` and `cookies[]`. The `ApiClient` constructor loads the saved
session and checks if the stored `apiUrl` matches the requested one.

### ClickHouse Proxy Client

`ProxyClickhouseClient` extends `BaseClickhouseClient` from common-utils. It:

- Routes queries through `/clickhouse-proxy` (sets `pathname`)
- Injects session cookies for auth
- Passes `x-hyperdx-connection-id` header
- Disables basic auth (`set_basic_auth_header: false`)
- Forces `content-type: text/plain` to prevent Express body parser issues

### Source Expressions

Sources have many expression fields that map to ClickHouse column names. Key
ones used in the CLI:

- `timestampValueExpression` — Primary timestamp (often `TimestampTime`,
  DateTime)
- `displayedTimestampValueExpression` — High-precision timestamp (often
  `Timestamp`, DateTime64 with nanoseconds). **Use this for waterfall queries.**
- `traceIdExpression`, `spanIdExpression`, `parentSpanIdExpression`
- `bodyExpression`, `spanNameExpression`, `serviceNameExpression`
- `durationExpression` + `durationPrecision` (3=ms, 6=μs, 9=ns)
- `eventAttributesExpression`, `resourceAttributesExpression`
- `logSourceId`, `traceSourceId` — Correlated source IDs

### useInput Handler Ordering

The `useInput` callback in EventViewer has a specific priority order. **Do not
reorder these checks**:

1. `?` toggles help (except when search focused)
2. Any key closes help when showing
3. `focusDetailSearch` — consumes all keys except Esc/Enter
4. `focusSearch` — consumes all keys except Tab/Esc
5. Trace tab j/k — when detail panel open and Trace tab active
6. General j/k, G/g, Enter/Esc, Tab, etc.
7. Single-key shortcuts: `w`, `f`, `/`, `s`, `t`, `q`

### Dynamic Table Columns

When `customSelect` is set (via `s` key), columns are derived from the query
result keys. Otherwise, hardcoded percentage-based columns are used per source
kind. The `getDynamicColumns` function distributes 60% evenly among non-last
columns, with the last column getting the remainder.

### Follow Mode

- Enabled by default on startup
- Slides `timeRange` forward every 2s, triggering a replace fetch
- **Paused** when detail panel opens (`wasFollowingRef` saves previous state)
- **Restored** when detail panel closes

### Custom Select Per Source

`customSelectMap: Record<string, string>` stores custom SELECT overrides keyed
by `source.id`. Each source remembers its own custom select independently.
