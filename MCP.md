# ClickStack MCP Server

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
claude mcp add --transport http clickstack <your-hyperdx-url>/api/mcp \
  --header "Authorization: Bearer <your-personal-access-key>"
```

### Codex CLI

The Codex CLI reads the bearer token from an environment variable rather than a
`--header` flag. Export your personal access key, then register the server with
`--bearer-token-env-var`:

```bash
export CLICKSTACK_ACCESS_KEY="<your-personal-access-key>"
codex mcp add clickstack --url <your-hyperdx-url>/api/mcp \
  --bearer-token-env-var CLICKSTACK_ACCESS_KEY
```

### OpenCode

Add the following to your [OpenCode config](https://opencode.ai/docs/config):

```json
"mcp": {
  "clickstack": {
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
    "clickstack": {
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
| `clickstack_list_sources`        | List all data sources and connections as a lightweight catalog (IDs, names, kinds)            |
| `clickstack_describe_source`     | Full column schema, attribute keys, sampled low-cardinality values, and a round-trippable `config` block (the exact shape `clickstack_save_source` accepts, incl. correlation IDs) for a single source; for metric sources also returns a per-kind metric-name sample |
| `clickstack_save_source`         | Create (omit id) or update (provide id) a data source (log, trace, session, metric, or promql) so shipped telemetry becomes queryable. To clone a source, read its `config` from `clickstack_describe_source`, drop `id`, and pass it here |
| `clickstack_delete_source`       | Permanently delete a data source by ID                                                        |
| `clickstack_list_metrics`        | Paginated catalog of metric names on a metric source with optional kind / namePattern / time-window filters |
| `clickstack_describe_metric`     | Per-metric drill-down: kind(s), unit, description, attribute keys per map column, and sampled values |
| `clickstack_timeseries`          | Plot metrics over time as a line or stacked bar chart (works on log, trace, and metric sources)        |
| `clickstack_table`               | Compute aggregated metrics as a table, single number, or pie chart (works on log, trace, and metric sources) |
| `clickstack_search`              | Browse individual log, event, or trace rows                                                  |
| `clickstack_event_patterns`      | Discover the most common log messages and event patterns using Drain clustering               |
| `clickstack_event_deltas`        | Compare two row groups and rank properties by how their value distributions differ            |
| `clickstack_sql`                 | Execute raw ClickHouse SQL for advanced queries (JOINs, CTEs, sub-queries)                   |
| `clickstack_get_dashboard`       | List all dashboards or get full detail for a specific dashboard                              |
| `clickstack_save_dashboard`      | Create or update a dashboard with tiles (charts, tables, numbers, search, markdown)          |
| `clickstack_delete_dashboard`    | Permanently delete a dashboard and its attached alerts                                       |
| `clickstack_query_tile`          | Execute the query for a specific dashboard tile to validate results                          |
| `clickstack_get_saved_search`    | List all saved searches or get full detail for a specific saved search                       |
| `clickstack_save_saved_search`   | Create or update a saved search (reusable query against a data source)                       |
| `clickstack_get_alert`           | List alerts (summary) or get full detail with evaluation history; filter by state             |
| `clickstack_save_alert`          | Create a new alert or update an existing one                                                 |
| `clickstack_trace_waterfall`     | Fetch all spans in a single trace as a parent/child waterfall tree with optional correlated logs |
| `clickstack_trace_top_time_consuming_operations` | Aggregate breakdown of child operations by cumulative time across matching parent traces |
| `clickstack_get_webhook`         | List available webhook destinations for use as alert notification channels                    |
| `clickstack_save_webhook`        | Create (omit id) or update (provide id) a webhook notification destination (slack, generic, or incidentio) |
| `clickstack_delete_webhook`      | Permanently delete a webhook by ID (blocked while alerts still reference it)                   |

### Metric Sources

`clickstack_timeseries`, `clickstack_table`, and the dashboard builder tile
tools accept metric sources transparently. Each `select` item on a metric
query must set `metricType` (`"gauge"`, `"sum"`, `"histogram"`, or
`"exponential histogram"`) and
`metricName` (the OTel metric name, e.g. `system.cpu.utilization`).
`valueExpression` defaults to `"Value"` when omitted, so a typical metric
series looks like:

```jsonc
{ "aggFn": "avg", "metricType": "gauge", "metricName": "system.cpu.utilization" }
```

Per-kind aggregation guidance:

- **Gauge**: `avg`, `last_value`, `min`, or `max`. Set `"isDelta": true` for
  Prometheus-style delta over each bucket.
- **Sum (counter)**: `"increase"` returns the per-bucket counter increase
  (reset-aware), or `sum` / `avg` on the computed rate. `increase` combined
  with `groupBy` is capped at the top 20 groups by the renderer; the tool
  emits a neutral hint when the cap may apply.
- **Histogram**: `"quantile"` with `level` ∈ {0.5, 0.9, 0.95, 0.99} for
  percentiles, or `"count"` for the total bucket count.
- **Exponential histogram**: `"quantile"` with `level` ∈
  {0.5, 0.9, 0.95, 0.99} for percentiles, or `"count"` for the total bucket
  count.

`summary` metrics are not yet supported by the query renderer.

Discovery workflow for metrics:

1. `clickstack_list_sources` to find the metric source ID and its
   `metricTables` map.
2. `clickstack_describe_source` to see columns, attribute keys, and a
   per-kind metric-name sample.
3. `clickstack_list_metrics` for paginated catalog access with optional
   kind / namePattern / time-window filters; pass `nextCursor` unchanged
   for the next page.
4. `clickstack_describe_metric` to drill into a specific metric and
   discover its attribute keys + sampled values before authoring queries.
5. `clickstack_timeseries` / `clickstack_table` to chart the metric.
