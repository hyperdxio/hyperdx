# @hyperdx/cli

[![npm version](https://img.shields.io/npm/v/@hyperdx/cli.svg)](https://www.npmjs.com/package/@hyperdx/cli)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)

Terminal UI and CLI for [HyperDX](https://github.com/hyperdxio/hyperdx) —
search, tail, chart, and query your logs, traces, and metrics without leaving
the terminal.

The CLI talks to your HyperDX instance (Cloud or self-hosted) and runs the exact
same query pipeline as the web app, so results always match what you see in the
browser.

## Install

```bash
npm install -g @hyperdx/cli    # installs the `hdx` binary
# or run without installing:
npx @hyperdx/cli --help
```

Requires Node.js >= 22.16.

## Quickstart

```bash
# Sign in (interactive — prompts for app URL and credentials)
hdx auth login

# Launch the interactive TUI
hdx tui

# Chart error volume by service for the past 3 hours
hdx chart -s Logs --where 'SeverityText:error' --group-by ServiceName --since 3h

# Run raw SQL against ClickHouse
hdx query --connection-id "$CONN" --sql "SELECT count() FROM default.otel_logs"
```

## Features

- **Interactive TUI** — search and live-tail events, inspect rows, and walk
  trace waterfalls with vim-style keybindings
- **Trace waterfall** — full span tree with correlated logs, span-level detail,
  and open-in-browser deep links
- **Terminal charts** — render saved dashboard tiles or ad-hoc charts (line,
  stacked bar, number, table, bar, pie) as ANSI output
- **Raw SQL** — query ClickHouse directly through the HyperDX proxy, in any
  ClickHouse output format
- **Log pattern mining** — cluster query results into Drain log patterns to
  summarize large result sets
- **Alerts & dashboards** — browse alerts (with trigger history) and dashboards
  from the TUI
- **Multi-team support** — kubectx-style team switching for users in multiple
  teams
- **Agent-friendly** — `--json` output on discovery commands, NDJSON streaming,
  documented exit codes, and colors stripped automatically when piping

## Commands

```
hdx tui                             # Interactive TUI (search + live tail)
hdx chart -d <dashboard> [-t tile]  # Render dashboard tiles as ANSI charts
hdx chart -s <source> [--agg ...]   # Ad-hoc chart over a source
hdx chart --sql <query> -s <source> # Ad-hoc chart from raw SQL
hdx query --connection-id <id> --sql <query>  # Raw SQL to stdout
hdx sources                         # List data sources with table schemas
hdx connections                     # List ClickHouse connections
hdx dashboards                      # List dashboards with tile summaries
hdx auth login|status|logout        # Manage authentication
hdx team list|current|use <team>    # Switch between teams
hdx upload-sourcemaps               # Upload JS source maps
```

Every command accepts `-a, --app-url <url>` to point at a HyperDX instance.
After `hdx auth login`, the URL is saved and the flag becomes optional. Run
`hdx <command> --help` for full flag documentation.

### `hdx tui` — Interactive TUI

The main event viewer: a searchable, live-tailing table of logs or traces with a
detail panel, trace waterfall, pattern mining, alerts, and dashboards.

```bash
hdx tui                          # Pick a source interactively
hdx tui --source "Logs"          # Skip the source picker
hdx tui -q "level:error" -f      # Start with a search query, in follow mode
```

| Key           | Action                                     |
| ------------- | ------------------------------------------ |
| `j` / `↓`     | Move selection down                        |
| `k` / `↑`     | Move selection up                          |
| `l` / `Enter` | Expand row detail                          |
| `h` / `Esc`   | Close detail / blur search                 |
| `G` / `g`     | Jump to newest / oldest                    |
| `Ctrl+D/U`    | Page down / up                             |
| `/`           | Search (global in table, filter in detail) |
| `Tab`         | Cycle sources/searches or detail tabs      |
| `Shift+Tab`   | Cycle backwards                            |
| `t`           | Edit time range in `$EDITOR`               |
| `s`           | Edit SELECT clause in `$EDITOR`            |
| `Shift+P`     | Show event patterns                        |
| `Shift+D`     | Show generated SQL                         |
| `f`           | Toggle follow mode (live tail)             |
| `o`           | Open trace in browser                      |
| `w`           | Toggle line wrap                           |
| `Shift+A`     | Open alerts page                           |
| `d`           | Open dashboards page                       |
| `?`           | Toggle help                                |
| `q`           | Quit                                       |

The row detail panel has three tabs — **Overview** (structured OTel attributes),
**Column Values** (every column of the row), and **Trace** (span waterfall with
correlated logs, navigable with `j`/`k`).

### `hdx chart` — Terminal charts

Render charts as terminal output. Designed for troubleshooting from the CLI
(including by AI agents): visualize a metric, spot the spike, then narrow down
with `--where` or `hdx query`. All modes run through the same
`renderChartConfig` pipeline as the web dashboards.

Three modes:

```bash
# 1. Dashboard tiles — render saved tiles from a dashboard
hdx chart -d "Service Health"                       # All tiles, past 1h
hdx chart -d "Service Health" -t "P95 Latency" --since 24h

# 2. Ad-hoc builder — chart an aggregation over a source
hdx chart -s Logs --where 'SeverityText:error' --group-by ServiceName --since 3h
hdx chart -s Traces --agg quantile --level 0.95 --value Duration \
    --where 'ServiceName:api' --since 6h
hdx chart -s Logs --display bar --where 'SeverityText:error' --group-by ServiceName
hdx chart -s Metrics --metric-type sum --metric-name otelcol_exporter_sent_spans

# 3. Raw SQL — chart arbitrary queries with time macros
hdx chart -s Logs --sql "SELECT \$__timeInterval(TimestampTime) AS ts, count()
    FROM default.otel_logs WHERE \$__timeFilter(TimestampTime) GROUP BY ts ORDER BY ts"
```

- **Display types** (`--display`): `line` (default), `stacked_bar`, `number`,
  `table`, `bar`, `pie`
- **Time ranges**: `--since 15m|1h|7d`, or `--from`/`--to` with ISO 8601
  (`2026-07-01T00:00:00Z`), dates (`2026-07-01`), or relative values (`now-24h`)
- **SQL macros**: `$__timeFilter(col)` expands to the selected range,
  `$__timeInterval(col)` buckets by the chart granularity
- **Output**: ANSI colors are stripped automatically when piping (override with
  `--color always|never`); `--json` emits raw rows + column metadata

### `hdx query` — Raw SQL

Execute raw ClickHouse SQL through the HyperDX proxy. Output defaults to
`JSONEachRow` (NDJSON — one JSON object per line), so results pipe cleanly into
`jq` and friends. Any ClickHouse output format is accepted via `--format`
(`JSON`, `TabSeparated`, `CSV`, ...).

```bash
CONN=$(hdx connections --json | jq -r '.[0].id')
hdx query --connection-id "$CONN" --sql "SELECT count() FROM default.otel_logs"
hdx query --connection-id "$CONN" --sql "SELECT * FROM default.otel_traces LIMIT 5"
```

**Pattern mining** (`--patterns`): cluster the result into templated log
patterns using the [Drain](https://github.com/logpai/Drain3) algorithm and emit
one JSON object per pattern, sorted by count — useful for summarizing thousands
of rows into a handful of templates:

```bash
hdx query --connection-id "$CONN" --patterns \
    --sql "SELECT Body FROM default.otel_logs LIMIT 10000" --body-column Body
# {"pattern":"connection <*> closed","count":4823,"sample":"connection 10.0.3.7 closed"}
```

Exit codes: `0` on success (empty stdout means zero rows), `1` on failure.

### `hdx sources` / `hdx connections` / `hdx dashboards` — Discovery

List the data sources, ClickHouse connections, and dashboards available to your
team. All three support `--json` for structured output.

```bash
hdx sources               # Sources with ClickHouse CREATE TABLE schemas
hdx sources --json        # Includes column expression mappings per source
hdx connections --json    # Connection IDs for `hdx query` / `hdx chart --sql`
hdx dashboards            # Dashboards + tile names for `hdx chart -d`
```

### `hdx auth` — Authentication

```bash
hdx auth login                                    # Interactive prompts
hdx auth login -a https://your-hyperdx.example \
    -e user@example.com -p "$PASSWORD"            # Non-interactive (CI)
hdx auth status                                   # Who am I + active team
hdx auth logout
```

The session is saved to `~/.config/hyperdx/cli/session.json` (mode `0600`) and
reused by all commands until it expires.

### `hdx team` — Team switching

For users that belong to multiple teams (HyperDX Cloud / EE), switch the team
that all commands are scoped to — kubectx-style:

```bash
hdx team list             # All teams, active one marked
hdx team current          # Print the active team
hdx team use "My Team"    # Switch by name or ID
```

The choice persists across CLI invocations. On single-team deployments these
commands are effectively no-ops.

### `hdx upload-sourcemaps` — Source maps

Upload JavaScript source maps to HyperDX for stack trace de-obfuscation. Run it
in your build pipeline:

```bash
npx @hyperdx/cli upload-sourcemaps \
  --serviceKey "$HYPERDX_API_ACCESS_KEY" \
  --apiUrl "$HYPERDX_API_URL" \
  --path .next \
  --releaseId "$RELEASE_ID"
```

| Flag                     | Description                                            | Default |
| ------------------------ | ------------------------------------------------------ | ------- |
| `-k, --serviceKey <key>` | HyperDX service account API key                        |         |
| `-p, --path <dir>`       | Directory containing sourcemaps                        | `.`     |
| `-u, --apiUrl <url>`     | HyperDX API URL (required for self-hosted deployments) |         |
| `-rid, --releaseId <id>` | Release ID to associate with the sourcemaps            |         |
| `-bp, --basePath <path>` | Base path for the uploaded sourcemaps                  |         |
| `--apiVersion <version>` | API version: `v1` (HyperDX V1 Cloud) or `v2` (latest)  | `v1`    |

Optionally, set the `HYPERDX_SERVICE_KEY` environment variable to avoid passing
the `--serviceKey` flag.

## For AI agents & scripting

The CLI is built to be driven by scripts and AI agents:

- `hdx sources --json`, `hdx connections --json`, `hdx dashboards --json`, and
  `hdx team list --json` emit structured output for discovery
- `hdx query` streams NDJSON by default and documents its exit-code contract
  (`0` success, `1` failure — with "unknown connection" distinguished from "bad
  SQL" on stderr)
- `hdx query --patterns` compresses large result sets into a few templated
  patterns
- `hdx chart --json` returns the queried rows + column metadata instead of a
  rendered chart; ANSI colors are stripped automatically when stdout is not a
  TTY
- Non-interactive login: `hdx auth login -a <url> -e <email> -p <password>`

## Links

- [HyperDX repository](https://github.com/hyperdxio/hyperdx)
- [ClickStack documentation](https://clickhouse.com/docs/use-cases/observability/clickstack/overview)
- [Report an issue](https://github.com/hyperdxio/hyperdx/issues)
- [Contributing](https://github.com/hyperdxio/hyperdx/tree/main/packages/cli/CONTRIBUTING.md)

## License

[MIT](https://github.com/hyperdxio/hyperdx/blob/main/LICENSE)
