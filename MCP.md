# HyperDX MCP Server

HyperDX exposes a
[Model Context Protocol (MCP)](https://modelcontextprotocol.io/) server that
lets AI assistants query your observability data, manage dashboards, and explore
data sources directly.

## Prerequisites

- A running HyperDX instance (see [CONTRIBUTING.md](/CONTRIBUTING.md) for local
  development setup, or [DEPLOY.md](/DEPLOY.md) for self-hosted deployment)
- A **Personal API Access Key** — find yours in the HyperDX UI under **Team
  Settings > API Keys > Personal API Access Key**

> **Note:** HyperDX v1 ([hyperdx.io](https://hyperdx.io)) does not yet support
> the MCP server. The documentation below applies to self-hosted HyperDX v2
> (Free and Enterprise).

## Endpoint

The MCP server is available at the `/api/mcp` path on your HyperDX instance. For
local development this is:

```
http://localhost:8080/api/mcp
```

Replace `localhost:8080` with your instance's host and port if you've customized
the defaults.

> **Note:** The examples below use `localhost:8080` (the frontend app). You can
> also reach the MCP server directly at `<backend_url>/mcp`, but not all
> deployments expose the backend, so these docs use frontend paths.

## Connecting an MCP Client

The MCP server uses the **Streamable HTTP** transport with Bearer token
authentication. In the examples below, replace `<your-hyperdx-url>` with your
instance URL (e.g. `http://localhost:8080`).

### Claude Code

```bash
claude mcp add --transport http hyperdx <your-hyperdx-url>/api/mcp \
  --header "Authorization: Bearer <your-personal-access-key>"
```

### OpenCode

Add the following to your [OpenCode config](https://opencode.ai/docs/config):

```json
"mcp": {
  "hyperdx": {
    "enabled": true,
    "type": "remote",
    "url": "<your-hyperdx-url>/api/mcp",
    "headers": {
      "Authorization": "Bearer <your-personal-access-key>"
    }
  }
}
```

### Cursor

Add the following to `.cursor/mcp.json` in your project (or your global Cursor
settings):

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
3. **Authentication:** Header `Authorization` with value
   `Bearer <your-personal-access-key>`
4. Click **Connect**

### Other Clients

Any MCP client that supports Streamable HTTP transport can connect. Configure it
with:

- **URL:** `<your-hyperdx-url>/api/mcp`
- **Header:** `Authorization: Bearer <your-personal-access-key>`

## Available Tools

| Tool                          | Description                                                                                  |
| ----------------------------- | -------------------------------------------------------------------------------------------- |
| `hyperdx_list_sources`        | List all data sources and connections as a lightweight catalog (IDs, names, kinds)            |
| `hyperdx_describe_source`     | Full column schema, attribute keys, and sampled low-cardinality values for a single source    |
| `hyperdx_timeseries`          | Plot metrics over time as a line or stacked bar chart                                        |
| `hyperdx_table`               | Compute aggregated metrics as a table, single number, or pie chart                           |
| `hyperdx_search`              | Browse individual log, event, or trace rows                                                  |
| `hyperdx_event_patterns`      | Discover the most common log messages and event patterns using Drain clustering               |
| `hyperdx_event_deltas`        | Compare two row groups and rank properties by how their value distributions differ            |
| `hyperdx_sql`                 | Execute raw ClickHouse SQL for advanced queries (JOINs, CTEs, sub-queries)                   |
| `hyperdx_get_dashboard`       | List all dashboards or get full detail for a specific dashboard                              |
| `hyperdx_save_dashboard`      | Create or update a dashboard with tiles (charts, tables, numbers, search, markdown)          |
| `hyperdx_delete_dashboard`    | Permanently delete a dashboard and its attached alerts                                       |
| `hyperdx_query_tile`          | Execute the query for a specific dashboard tile to validate results                          |
| `hyperdx_get_saved_search`    | List all saved searches or get full detail for a specific saved search                       |
| `hyperdx_save_saved_search`   | Create or update a saved search (reusable query against a data source)                       |
| `hyperdx_get_alert`           | List alerts (summary) or get full detail with evaluation history; filter by state             |
| `hyperdx_save_alert`          | Create a new alert or update an existing one                                                 |
| `hyperdx_get_webhook`         | List available webhook destinations for use as alert notification channels                    |
