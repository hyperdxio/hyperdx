# HyperDX MCP Apps: Developer Notes

Phase 0 of the MCP Apps experiment: the `hyperdx_query` tool returns
`structuredContent` plus a `_meta` reference to a sandboxed iframe widget. Hosts
that support the [MCP Apps extension](https://modelcontextprotocol.io/extensions/apps/overview)
(Claude, Claude Desktop, Cursor, Goose, Postman, MCPJam, the official
`basic-host` reference client) render the widget inline.

## Where things live

| File | Role |
| --- | --- |
| `packages/mcp-widget/` | Vite + React + `@modelcontextprotocol/ext-apps` widget bundle. Builds to a single inlined HTML at `dist/mcp-app.html`. |
| `packages/api/src/mcp/ui/widget.ts` | Registers the widget bundle as the `ui://hyperdx/widget` MCP resource. Uses MIME `text/html;profile=mcp-app`. |
| `packages/api/src/mcp/tools/query/index.ts` | `hyperdx_query` tool. Tags itself with `_meta["ui/resourceUri"]` + `_meta.ui.resourceUri`. |
| `packages/api/src/mcp/tools/query/helpers.ts` | Builds the `structuredContent` payload (`displayType`, `config`, `data`, `links.openInHyperdxUrl`). |
| `packages/api/src/mcp/__tests__/widget.test.ts` | Contract tests (no ClickHouse needed). |

## Running locally

```bash
yarn dev                 # full HyperDX stack on slot 79
                         # (rebuilds the widget bundle once, runs Vite watch
                         #  in MCP-WIDGET pane during dev)
```

Get the personal access key from the user's profile (or, on a fresh stack,
register and fetch it from `GET /me`):

```bash
curl -b cookies.txt http://localhost:30179/me | jq -r .accessKey
```

The MCP endpoint is `http://localhost:30279/api/mcp` with header
`Authorization: Bearer <key>`.

## Testing the widget rendering without Claude

The official `basic-host` reference client is the simplest way. We sparse-clone
it under `.agent-tmp/ext-apps-repo` and patch it for Bearer-token auth.

```bash
# 1. Make sure .agent-tmp/key contains your personal access key.
echo "<your-access-key>" > .agent-tmp/key

# 2. Start the host (terminal 1, leaves it running).
./.agent-tmp/start-basic-host.sh

# 3. Drive it via Playwright to render line/table/number views and capture
#    screenshots into .agent-tmp/screenshots/.
node .agent-tmp/drive-host.mjs

# 4. Open http://localhost:8080 in a browser to drive it interactively.
```

Both the host and our MCP server need to be up. `start-basic-host.sh` reads
the key from `.agent-tmp/key` and points basic-host at slot 79's MCP endpoint.

### Configuring Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "hyperdx": {
      "command": "npx",
      "args": [
        "-y",
        "supergateway",
        "--streamableHttp",
        "http://localhost:30279/api/mcp",
        "--header",
        "Authorization: Bearer <YOUR_ACCESS_KEY>",
        "--logLevel",
        "none"
      ]
    }
  }
}
```

Quit and reopen Claude (⌘Q), then ask "list my hyperdx sources" to verify the
connection. If the host supports MCP Apps rendering, queries through
`hyperdx_query` will render an inline iframe with the widget; otherwise you
get the JSON `content` text and the widget is silently skipped.

## What's working today (Phase 0)

- Line, table, number views render correctly with real ClickHouse data.
- "Open in HyperDX" button uses `app.openLink()` to deep-link to
  `/chart?config=<json>&from=<ms>&to=<ms>` in the HyperDX console.
- `granularity` flows through `hyperdx_query` for time-series displays.

## Known gaps

- **Other display types** (`pie`, `stacked_bar`, `search`, `sql`, `markdown`)
  pass through the server end-to-end but the widget only renders
  line/table/number. Adding one is ~30 lines in `packages/mcp-widget/src/views.tsx`.
- **No bidirectional refresh yet.** The widget receives the initial
  `tool-result` and renders; there's no UI control yet to call back into
  `hyperdx_query` with a different time range. This is what `app.callServerTool`
  is for; trivial to add when needed.
- **The widget uses hand-rolled SVG, not the real dashboard tile components.**
  Phase 1 is to extract pure presenters from `packages/app/src/components/`
  (`DBTimeChart`, `DBTableChart`, `DBNumberChart`) so the widget renders
  pixel-identically to dashboard tiles. The MCP-Apps sandbox forces a clean
  data-only boundary; today we paid the duplication cost in exchange for
  zero coupling to Mantine/Jotai/TanStack Query during the protocol bring-up.

## Why each piece is shaped this way

- **Widget MIME = `text/html;profile=mcp-app`**: hosts use the `;profile=mcp-app`
  suffix to distinguish App resources from arbitrary HTML. Plain `text/html`
  triggers an "Unsupported UI resource content format" error.
- **`_meta["ui/resourceUri"]` AND `_meta.ui.resourceUri`**: the spec/SDK
  normalizes both, but at least one host (Claude Desktop) reads only the
  slash-key form. Emitting both is harmless and forward-compatible.
- **Permissive CORS only on `/mcp`**: MCP clients connect from arbitrary
  origins (host pages, browser-based playgrounds). Bearer auth is in the
  header, not cookies, so the strict same-origin policy used elsewhere
  doesn't apply.
- **Widget is its own `packages/mcp-widget` workspace, not inside `packages/app`**:
  the bundle ships into iframes outside HyperDX. It can't import Mantine,
  Jotai, Next.js router, etc.; those would balloon the bundle and break
  inside the sandbox. Keeping it separate is the cheapest enforcement
  mechanism.
