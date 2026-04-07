# @hyperdx/cli

Command line interface for HyperDX — upload source maps and interactively
search, tail, and inspect logs and traces from the terminal.

## Installation

### npm (recommended)

```bash
npm install -g @hyperdx/cli
```

Or run directly with npx (no install needed):

```bash
npx @hyperdx/cli upload-sourcemaps --apiVersion v2 --path .next
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

## Uploading Source Maps

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

| Flag                      | Description                                               | Default |
| ------------------------- | --------------------------------------------------------- | ------- |
| `-k, --serviceKey <key>`  | HyperDX service account API key                           |         |
| `-p, --path <dir>`        | Directory containing sourcemaps                           | `.`     |
| `-u, --apiUrl <url>`      | HyperDX API URL (required for self-hosted deployments)    |         |
| `-rid, --releaseId <id>`  | Release ID to associate with the sourcemaps               |         |
| `-bp, --basePath <path>`  | Base path for the uploaded sourcemaps                     |         |
| `--apiVersion <version>`  | API version (`v1` for HyperDX V1 Cloud, `v2` for latest) | `v1`    |

> **Note:** Use `--apiVersion v2` for the latest HyperDX app. The `v1` default
> is only for legacy HyperDX V1 Cloud deployments.

Optionally, set the `HYPERDX_SERVICE_KEY` environment variable to avoid passing
the `--serviceKey` flag.

## Interactive TUI

### Authentication

Before using the TUI, authenticate with your HyperDX instance. The `-s` flag
takes the **HyperDX API URL** (e.g. `https://your-instance.hyperdx.io/api`):

```bash
hdx auth login -s <your-hyperdx-api-url>
```

Once logged in, the `-s` flag is optional — the CLI reads the API URL from the
saved session (`~/.config/hyperdx/cli/session.json`).

```bash
hdx auth status        # Show authentication status
hdx auth logout        # Log out and clear saved session
```

### `hdx tui`

Interactive event viewer with table, search, and row detail panel.

```bash
hdx tui                           # Uses saved session API URL
hdx tui -s <your-hyperdx-api-url> # Explicit API URL
hdx tui -q "level:error"          # Start with a Lucene query
hdx tui --source "Logs"           # Skip source picker
hdx tui -f                        # Start in follow/live tail mode
```

| Flag                 | Description              |
| -------------------- | ------------------------ |
| `-s, --server <url>` | HyperDX API URL          |
| `-q, --query <query>`| Lucene search query      |
| `--source <name>`    | Source name (skip picker) |
| `-f, --follow`       | Start in follow mode     |

### Keybindings

| Key             | Action                                     |
| --------------- | ------------------------------------------ |
| `j` / `↓`       | Move selection down                        |
| `k` / `↑`       | Move selection up                          |
| `l` / `Enter`   | Expand row detail                          |
| `h` / `Esc`     | Close detail / blur search                 |
| `G`             | Jump to newest                             |
| `g`             | Jump to oldest                             |
| `Ctrl+D`        | Scroll half-page down                      |
| `Ctrl+U`        | Scroll half-page up                        |
| `/`             | Search (global or detail filter)           |
| `Tab`           | Cycle sources/searches or detail tabs      |
| `Shift+Tab`     | Cycle backwards                            |
| `s`             | Edit SELECT clause in $EDITOR              |
| `t`             | Edit time range in $EDITOR                 |
| `f`             | Toggle follow mode (live tail)             |
| `w`             | Toggle line wrap                           |
| `?`             | Toggle help screen                         |
| `q`             | Quit                                       |

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
