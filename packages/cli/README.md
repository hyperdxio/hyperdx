# @hyperdx/cli

A terminal UI for searching and tailing events (logs and traces) from HyperDX.

Built with [Ink](https://github.com/vadimdemedes/ink) (React for CLIs) and
compiled into a standalone binary via [Bun](https://bun.sh).

## Installation

### npm (recommended)

```bash
npm install -g @hyperdx/cli
```

Or run directly with npx (no install needed):

```bash
npx @hyperdx/cli tui -s <your-hyperdx-url>
```

### Standalone Binary

Download the latest binary for your platform from the
[Releases](https://github.com/hyperdxio/hyperdx/releases) page (no Node.js
required):

```bash
# macOS Apple Silicon
curl -L https://github.com/hyperdxio/hyperdx/releases/latest/download/hdx-darwin-arm64 -o hdx

# macOS Intel
curl -L https://github.com/hyperdxio/hyperdx/releases/latest/download/hdx-darwin-x64 -o hdx

# Linux x64
curl -L https://github.com/hyperdxio/hyperdx/releases/latest/download/hdx-linux-x64 -o hdx

chmod +x hdx
sudo mv hdx /usr/local/bin/
```

## Quick Start

```bash
# Install
npm install -g @hyperdx/cli

# Login to your HyperDX instance
hdx auth login -s https://your-hyperdx-instance.com

# Launch the interactive TUI
hdx tui
```

## Commands

### `hdx tui`

Interactive event viewer with table, search, and row detail panel.

```bash
hdx tui                                             # Uses saved session server
hdx tui -s http://localhost:8000                    # Explicit server URL
hdx tui -q "level:error"                           # Start with a Lucene query
hdx tui --source "Logs"                            # Skip source picker
hdx tui -f                                         # Start in follow/live tail mode
```

### `hdx query`

Run a raw SQL query against a ClickHouse source.

```bash
hdx query --source "Logs" --sql "SELECT count() FROM default.otel_logs"
hdx query --source "Traces" --sql "SELECT * FROM default.otel_traces LIMIT 5"
hdx query --source "Logs" --sql "SELECT Body FROM default.otel_logs LIMIT 3" --format JSONEachRow
```

| Flag                      | Description                              | Default |
| ------------------------- | ---------------------------------------- | ------- |
| `--source <nameOrId>`     | Source name or ID (required)             |         |
| `--sql <query>`           | SQL query to execute (required)          |         |
| `--format <format>`       | ClickHouse output format                 | `JSON`  |

### `hdx sources`

List available sources.

```bash
hdx sources                            # Human-readable table
hdx sources --json                     # JSON for agents / scripts
```

### `hdx dashboards`

List dashboards with tile summaries.

```bash
hdx dashboards                         # Human-readable list with tiles
hdx dashboards --json                  # JSON for agents / scripts
hdx dashboards --json | jq '.[0].tiles'  # List tiles of first dashboard
```

### `hdx upload-sourcemaps`

Upload JavaScript source maps to HyperDX for stack trace de-obfuscation.

```bash
npx @hyperdx/cli upload-sourcemaps \
  --serviceKey "$HYPERDX_API_ACCESS_KEY" \
  --apiUrl "$HYPERDX_API_URL" \
  --path .next \
  --apiVersion v2 \
  --releaseId "$RELEASE_ID"
```

You can also add this as an npm script:

```json
{
  "scripts": {
    "upload-sourcemaps": "npx @hyperdx/cli upload-sourcemaps --apiVersion v2 --path=\".next\""
  }
}
```

| Flag                      | Description                                      | Default |
| ------------------------- | ------------------------------------------------ | ------- |
| `-k, --serviceKey <key>`  | HyperDX service account API key                  |         |
| `-p, --path <dir>`        | Directory containing sourcemaps                  | `.`     |
| `-u, --apiUrl <url>`      | API URL for self-hosted deployments              |         |
| `-rid, --releaseId <id>`  | Release ID to associate with the sourcemaps      |         |
| `-bp, --basePath <path>`  | Base path for the uploaded sourcemaps            |         |
| `--apiVersion <version>`  | API version (`v1` for HyperDX V1 Cloud, `v2` for latest) | `v1`    |

> **Note:** Use `--apiVersion v2` for the latest HyperDX app. The `v1` default
> is only for legacy HyperDX V1 Cloud deployments.

Optionally, set the `HYPERDX_SERVICE_KEY` environment variable to avoid passing
the `--serviceKey` flag.

### `hdx auth`

Manage authentication.

```bash
hdx auth login -s http://localhost:8000                              # Interactive login
hdx auth login -s http://localhost:8000 -e user@example.com -p pass  # Non-interactive login
hdx auth status                                                      # Show authentication status
hdx auth logout                                                      # Log out
```

The session is saved to `~/.config/hyperdx/cli/session.json`. Once logged in,
the `-s` flag is optional — the CLI reads the server URL from the saved session.

## Keybindings

| Key           | Action                                 |
| ------------- | -------------------------------------- |
| `j` / `↓`     | Move selection down                    |
| `k` / `↑`     | Move selection up                      |
| `l` / `Enter` | Expand row detail (SELECT \*)          |
| `h` / `Esc`   | Close row detail                       |
| `G`           | Jump to newest                         |
| `g`           | Jump to oldest                         |
| `/`           | Focus search bar                       |
| `Esc`         | Blur search bar                        |
| `Tab`         | Cycle through sources / saved searches |
| `Shift+Tab`   | Cycle backwards                        |
| `s`           | Edit select clause in $EDITOR          |
| `f`           | Toggle follow mode (live tail)         |
| `w`           | Toggle line wrap                       |
| `q`           | Quit                                   |

## Architecture

```
src/
├── cli.tsx              # Entry point, commander CLI
├── App.tsx              # App shell (login → pick source → viewer)
├── api/
│   ├── client.ts        # API client + ClickHouse proxy client
│   └── eventQuery.ts    # Query builder using renderChartConfig
├── components/
│   ├── EventViewer.tsx   # Table view + row detail panel
│   ├── LoginForm.tsx     # Email/password login prompt
│   └── SourcePicker.tsx  # Arrow-key source selector
└── utils/
    ├── config.ts         # Session persistence (~/.hyperdx/)
    └── silenceLogs.ts    # Suppress common-utils debug output
```

### How it works

1. **Auth**: Login via `POST /login/password`, session cookie stored on disk
2. **Sources**: Fetched from `GET /sources` (log + trace kinds)
3. **Saved searches**: Fetched from `GET /saved-searches`, switchable via Tab
4. **Queries**: Built using `renderChartConfig` from `@hyperdx/common-utils` —
   same SQL generation as the web frontend
5. **ClickHouse**: Queries go through the API's `/clickhouse-proxy` using the
   native `@clickhouse/client` node SDK with session cookie injection
6. **Row detail**: Expanding a row runs `SELECT * WHERE <row-id> LIMIT 1` to
   fetch all fields (LogAttributes, ResourceAttributes, etc.)

## Building

```bash
# TypeScript check
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

## Development

See [DEVELOPMENT.md](./DEVELOPMENT.md) for detailed development setup,
architecture details, and contribution guidelines.
