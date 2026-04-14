# HyperDX MCP Server

HyperDX exposes a [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) server that lets AI assistants query your observability
data, manage dashboards, and explore data sources directly.

## Prerequisites

- A running HyperDX instance (see [CONTRIBUTING.md](/CONTRIBUTING.md) for local development setup, or [DEPLOY.md](/DEPLOY.md) for
  self-hosted deployment)
- A **Personal API Access Key** — find yours in the HyperDX UI under **Team Settings > API Keys > Personal API Access Key**

## Endpoint

The MCP server is available at the `/api/mcp` path on your HyperDX instance. For local development this is:

```
http://localhost:8080/api/mcp
```

Replace `localhost:8080` with your instance's host and port if you've customized the defaults.

## Connecting an MCP Client

The MCP server uses the **Streamable HTTP** transport with Bearer token authentication. In the examples below, replace `<your-hyperdx-url>`
with your instance URL (e.g. `http://localhost:8080`).

### Claude Code

```bash
claude mcp add --transport http hyperdx <your-hyperdx-url>/api/mcp \
  --header "Authorization: Bearer <your-personal-access-key>"
```

### OpenCode

```bash
opencode mcp add --transport http hyperdx <your-hyperdx-url>/api/mcp \
  --header "Authorization: Bearer <your-personal-access-key>"
```

### Cursor

Add the following to `.cursor/mcp.json` in your project (or your global Cursor settings):

```json
{
  "mcpServers": {
    "hyperdx": {
      "url": "<your-hyperdx-url>/api/mcp",
      "headers": {
        "Authorization": "Bearer <your-personal-access-key>"
      }
    }
  }
}
```

### MCP Inspector

The MCP Inspector is useful for interactively testing and debugging the server.

```bash
cd packages/api && yarn dev:mcp
```

Then configure the inspector:

1. **Transport Type:** Streamable HTTP
2. **URL:** `<your-hyperdx-url>/api/mcp`
3. **Authentication:** Header `Authorization` with value `Bearer <your-personal-access-key>`
4. Click **Connect**

### Other Clients

Any MCP client that supports Streamable HTTP transport can connect. Configure it with:

- **URL:** `<your-hyperdx-url>/api/mcp`
- **Header:** `Authorization: Bearer <your-personal-access-key>`

## Available Tools

| Tool                       | Description                                                                                  |
| -------------------------- | -------------------------------------------------------------------------------------------- |
| `hyperdx_list_sources`     | List all data sources and database connections, including column schemas and attribute keys  |
| `hyperdx_query`            | Query observability data (logs, metrics, traces) using builder mode, search mode, or raw SQL |
| `hyperdx_get_dashboard`    | List all dashboards or get full detail for a specific dashboard                              |
| `hyperdx_save_dashboard`   | Create or update a dashboard with tiles (charts, tables, numbers, search, markdown)          |
| `hyperdx_delete_dashboard` | Permanently delete a dashboard and its attached alerts                                       |
| `hyperdx_query_tile`       | Execute the query for a specific dashboard tile to validate results                          |
