# @hyperdx/tui

A terminal UI for searching and tailing events (logs and traces) from HyperDX.

Built with [Ink](https://github.com/vadimdemedes/ink) (React for CLIs) and
compiled into a standalone binary via [Bun](https://bun.sh).

## Quick Start

```bash
# From the monorepo root
yarn install
```

### Running in dev mode

`yarn dev` runs `tsx src/cli.tsx` — no compile step needed.

```bash
cd packages/tui

# Interactive event viewer (default command)
yarn dev

# Pass flags after --
yarn dev -- events -s http://localhost:8000
yarn dev -- events -q "level:error" --source "Logs" -f
yarn dev -- stream --source "Logs" -f
yarn dev -- logout

# Enable verbose output for debugging
yarn dev -- events --verbose
```

On first run you'll be prompted to log in with your HyperDX email and password.
The session is saved to `~/.hyperdx/session.json`.

## Commands

### `hdx events` (default)

Interactive event viewer with table, search, and row detail panel.

```bash
hdx events                              # Interactive mode
hdx events -s http://localhost:8000     # Custom API server
hdx events -q "level:error"            # Start with a Lucene query
hdx events --source "Logs"             # Skip source picker
hdx events -f                          # Start in autoscroll/live tail mode
```

### `hdx stream`

Non-interactive streaming mode. Pipe-friendly, outputs to stdout.

```bash
hdx stream --source "Logs"                          # Stream events
hdx stream --source "Logs" -q "level:error" -f      # Filter + follow
hdx stream --source "Logs" --since 30m              # Last 30 minutes
hdx stream --source "Logs" -n 50                    # Limit 50 rows
```

### `hdx logout`

Clear the saved session.

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
| `s`           | Toggle autoscroll (live tail)          |
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

## Options

| Flag                   | Description                                 | Default                 |
| ---------------------- | ------------------------------------------- | ----------------------- |
| `-s, --server <url>`   | HyperDX API server URL                      | `http://localhost:8000` |
| `-q, --query <query>`  | Lucene search query                         |                         |
| `--source <name>`      | Source name (skips picker)                  |                         |
| `-f, --follow`         | Start in autoscroll/live tail mode          |                         |
| `--verbose`            | Enable debug output from internal libraries |                         |
| `--since <duration>`   | How far back to look (stream mode)          | `1h`                    |
| `-n, --limit <number>` | Max rows per fetch (stream mode)            | `100`                   |
