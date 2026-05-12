// Prompt content builders. Each function returns a plain string that is
// injected as a prompt message. This file is voice-clean (no em-dashes,
// no AI hallmarks) so the prose-lint hook treats it like any other
// reviewer-facing artifact.

export function buildCreateDashboardPrompt(
  sourceSummary: string,
  traceSourceId: string,
  logSourceId: string,
  description?: string,
): string {
  const userContext = description
    ? `\nThe user wants to create a dashboard for: ${description}\nTailor the dashboard tiles to match this goal.\n`
    : '';

  return `You are an expert at creating HyperDX observability dashboards.
${userContext}
${sourceSummary}

IMPORTANT: Call hyperdx_list_sources first to get the full column schema and attribute keys for each source. The source IDs above are correct, but you need the schema details to write accurate queries.

== WORKFLOW ==

1. Call hyperdx_list_sources to discover source IDs, column schemas, and attribute keys.
2. Pick the right source kind for the question. Trace data for request volume / latency / errors. Log data for severity / messages. Metric data for system telemetry.
3. Design the dashboard by following the design checklist below.
4. Call hyperdx_save_dashboard with the tiles, containers, and dashboard-level filters.
5. Call hyperdx_query_tile on each tile to confirm queries return data.

== UPDATING AN EXISTING DASHBOARD ==

When updating a dashboard (passing the top-level \`id\` to hyperdx_save_dashboard),
the \`filters\` array must be fully self-describing — every filter needs an \`id\`:

  - Existing filter you are KEEPING: copy its \`id\` verbatim from the
    hyperdx_get_dashboard response. The same applies if you are renaming
    or tweaking it. This preserves any savedFilterValues bound to that id.
  - New filter you are ADDING in this update: generate a fresh random
    24-character hex string (a Mongo-style ObjectId) and set it as \`id\`.
    Do not reuse an existing filter's id and do not leave \`id\` blank —
    omitting it would force the server to generate one and obscure the
    new filter's identity from your own bookkeeping.
  - Existing filter you are REMOVING: drop it from the array entirely.

Recommended pattern:

  1. \`hyperdx_get_dashboard({ id })\` to capture the current \`filters[]\`
     and their ids.
  2. Build the new array: spread the kept filters as-is, append new
     filters with freshly-minted ids, omit removed ones.
  3. \`hyperdx_save_dashboard({ id, ..., filters: <new array> })\`.

== TILE TYPE GUIDE ==

Use BUILDER tiles (with sourceId) for most cases:
  line         Time-series trends (error rate, request volume, latency over time).
  stacked_bar  Compare categories over time (requests by service, errors by status code).
  number       Single KPI metric (total requests, current error rate, p99 latency).
  table        Ranked lists (top endpoints by latency, error counts by service).
  pie          Proportional breakdowns (traffic share by service, errors by type). Keep slice count under 8.
  heatmap      Distribution of a numeric value over time (latency buckets, payload size). Trace sources only. Requires non-empty valueExpression.
  search       Browse raw log/event rows (error logs, recent traces).
  markdown     Dashboard notes, section headers, or documentation.

Use RAW SQL tiles (with connectionId) only for queries the builder cannot express:
  Requires configType: "sql" plus a displayType (line, stacked_bar, table, number, pie).
  Use when you need JOINs, sub-queries, CTEs, or expressions the builder does not generate.

== COLUMN NAMING ==

- Top-level columns use PascalCase by default: Duration, StatusCode, SpanName, Body, SeverityText, ServiceName, SpanKind.
  NOTE: These are defaults for the standard HyperDX schema. Custom sources may use different names.
  Always call hyperdx_list_sources to get the real column names and keyColumns for each source.
- Map-type columns use bracket syntax: SpanAttributes['http.method'], ResourceAttributes['service.name'].
  NEVER use dot notation for Map columns. Always use brackets.
- JSON-type columns use dot notation: JsonColumn.key.subkey.
  Check the jsType returned by hyperdx_list_sources to decide which a column is.

== DESIGN CHECKLIST ==

Apply these before calling hyperdx_save_dashboard. Each rule is enforced by the renderer; ignoring one is a runtime error you will then need to fix.

1. ONE QUESTION PER DASHBOARD. A dashboard answers a single observability question well. Split if the request mixes traces, logs, and metrics into unrelated views.

2. ALIAS EVERY AGGREGATION. Set alias on each select item ("Requests", "Errors", "P95 Duration"). Without alias, table headers read like raw expressions.

3. INVENTORY-STYLE TABLES PUT THE GROUP BY ON THE LEFT. Set groupByColumnsOnLeft: true on tables that read like a list of things (one row per service, per endpoint, per tenant).

4. RED COLUMNS FOR SERVICE / ENDPOINT TABLES. Request rate (count), Error rate (count with where: "StatusCode:STATUS_CODE_ERROR"), Duration (quantile P95 on the Duration column). Three columns, all aliased.

5. PER-SERIES NUMBER FORMAT FOR DURATIONS. Put numberFormat on each select item that needs special rendering. Example: { output: "duration", factor: 0.000000001 } on a Duration percentile. NEVER set chart-level numberFormat for tables that mix counts and durations; the count columns will render as 0:00:00.

6. LINE CHARTS CAN PASS UP TO 20 SELECT ITEMS. Plot related metrics together (p50, p95, p99 on one chart). Each series can carry its own numberFormat.

7. HEATMAPS FOR DISTRIBUTIONS. Trace duration buckets, payload size buckets. Trace sources only. Set numberFormat: { output: "duration", factor: 0.000000001 } on the chart config so the y-axis reads in human time.

8. FOR FOCUSED PER-DIMENSION DASHBOARDS, DECLARE A DASHBOARD-LEVEL FILTER. Pass filters: [{ type: "QUERY_EXPRESSION", name, expression, sourceId }] at the top level. The user gets a dropdown in the dashboard header; every tile on the same source re-scopes when a value is picked. Do NOT hardcode the dimension into each tile's where clause.

9. METRIC TILES TAKE EXACTLY ONE SELECT ITEM. Each metric is a separate query. To show multiple metrics side by side, create one tile per metric.

10. GROUP RELATED TILES INTO CONTAINERS. A container holds tiles that share a theme (Overview / Performance / Errors). Set containers: [{ id, title, collapsed }] at the top level and reference container ids from each tile via containerId. Use tabs when the same container needs to show different views of the same data; the tab bar appears when a container has two or more tabs.

== ADAPT, DO NOT COPY ==

The dashboard_examples prompt returns concrete example shapes. Read them as patterns to adapt to the user's actual request and schema, not as literal templates to substitute names into. Specifically: the literal "ServiceName", "StatusCode:STATUS_CODE_ERROR", "Duration" come from the standard HyperDX schema. Real source schemas may use different column names and status values; always verify with hyperdx_list_sources before reusing literals.

== COMMON MISTAKES TO AVOID ==

- Using valueExpression with aggFn "count" (count takes no valueExpression).
- Forgetting valueExpression for non-count aggFns (avg, sum, min, max, quantile all require it).
- Using dot notation for Map-type attributes (always use SpanAttributes['key'] bracket syntax).
- Skipping hyperdx_list_sources (you need real source IDs and real column names).
- Skipping hyperdx_query_tile after save (tiles can silently fail on syntax or attribute mismatches).
- Setting chart-level numberFormat on a table that mixes counts and durations (counts render as 0:00:00).
- Multiple select items on number / pie / heatmap / metric tiles (each takes exactly one).
- Missing level on aggFn "quantile" (must specify 0.5, 0.9, 0.95, or 0.99).
- Assuming StatusCode or SeverityText values (always inspect real values from hyperdx_list_sources).
- Heatmap on a non-Trace source (heatmap is Trace-only today).
- Hardcoding a focus dimension into every tile's where clause (use a dashboard-level filter instead).`;
}

export function buildDashboardExamplesPrompt(
  traceSourceId: string,
  logSourceId: string,
  connectionId: string,
  pattern?: string,
): string {
  const examples: Record<string, string> = {};

  examples['service_inventory'] = `
== SERVICE INVENTORY ==

When to use: the user wants a multi-service overview, one row per service, with RED columns (Requests / Errors / P95 Duration) and trends underneath. Swap "ServiceName" for any other dimension (operation.name, tenant_id, region) to inventory by that dimension instead.

Why this shape: the table answers "how is each thing doing right now". The Trends container answers "what changed over time". Tabs keep the trends section compact (only the active view renders).

{
  name: "Service Inventory",
  containers: [
    {
      id: "trends",
      title: "Trends",
      collapsed: false,
      tabs: [
        { id: "throughput", title: "Throughput" },
        { id: "latency",    title: "Latency"    },
        { id: "errors",     title: "Errors"     }
      ]
    }
  ],
  tiles: [
    {
      name: "Services",
      x: 0, y: 0, w: 24, h: 10,
      config: {
        displayType: "table",
        sourceId: "${traceSourceId}",
        select: [
          { aggFn: "count", alias: "Requests" },
          { aggFn: "count", where: "StatusCode:STATUS_CODE_ERROR", whereLanguage: "lucene", alias: "Errors" },
          {
            aggFn: "quantile", level: 0.95, valueExpression: "Duration", alias: "P95 Duration",
            numberFormat: { output: "duration", factor: 0.000000001 }
          }
        ],
        groupBy: "ServiceName",
        orderBy: "Requests DESC",
        groupByColumnsOnLeft: true
      }
    },
    {
      name: "Requests over time by service",
      containerId: "trends", tabId: "throughput",
      x: 0, y: 10, w: 24, h: 8,
      config: {
        displayType: "stacked_bar",
        sourceId: "${traceSourceId}",
        select: [ { aggFn: "count", alias: "Requests" } ],
        groupBy: "ServiceName"
      }
    },
    {
      name: "P95 Duration over time by service",
      containerId: "trends", tabId: "latency",
      x: 0, y: 10, w: 24, h: 8,
      config: {
        displayType: "line",
        sourceId: "${traceSourceId}",
        select: [
          {
            aggFn: "quantile", level: 0.95, valueExpression: "Duration", alias: "P95",
            numberFormat: { output: "duration", factor: 0.000000001 }
          }
        ],
        groupBy: "ServiceName"
      }
    },
    {
      name: "Errors over time by service",
      containerId: "trends", tabId: "errors",
      x: 0, y: 10, w: 24, h: 8,
      config: {
        displayType: "stacked_bar",
        sourceId: "${traceSourceId}",
        select: [
          { aggFn: "count", where: "StatusCode:STATUS_CODE_ERROR", whereLanguage: "lucene", alias: "Errors" }
        ],
        groupBy: "ServiceName"
      }
    }
  ]
}`;

  examples['service_detail'] = `
== SERVICE DETAIL ==

When to use: the user wants a focused per-service view (one service at a time, picked via a dropdown). Drop-in replacement: any per-dimension dashboard (per-endpoint, per-tenant, per-region) follows the same shape, just swap the filter expression.

Why this shape: a dashboard-level filter on ServiceName re-scopes every tile globally; tiles do NOT hardcode the service into their where clause. Four containers separate concerns: Overview (KPIs), Performance (latency line + heatmap), Endpoints (per-SpanName RED breakdown), Errors (top error messages + recent error spans). Errors container starts expanded so the user sees error context immediately when investigating.

{
  name: "Service Detail",
  filters: [
    {
      type: "QUERY_EXPRESSION",
      name: "Service",
      expression: "ServiceName",
      sourceId: "${traceSourceId}"
    }
  ],
  containers: [
    { id: "overview",    title: "Overview",                  collapsed: false },
    { id: "performance", title: "Performance",               collapsed: false },
    { id: "endpoints",   title: "Endpoints (per span name)", collapsed: false },
    { id: "errors",      title: "Errors",                    collapsed: false }
  ],
  tiles: [
    {
      name: "Requests", containerId: "overview",
      x: 0, y: 0, w: 8, h: 4,
      config: {
        displayType: "number",
        sourceId: "${traceSourceId}",
        select: [ { aggFn: "count", alias: "Requests" } ]
      }
    },
    {
      name: "Errors", containerId: "overview",
      x: 8, y: 0, w: 8, h: 4,
      config: {
        displayType: "number",
        sourceId: "${traceSourceId}",
        select: [ { aggFn: "count", where: "StatusCode:STATUS_CODE_ERROR", whereLanguage: "lucene", alias: "Errors" } ]
      }
    },
    {
      name: "P95 Duration", containerId: "overview",
      x: 16, y: 0, w: 8, h: 4,
      config: {
        displayType: "number",
        sourceId: "${traceSourceId}",
        select: [
          {
            aggFn: "quantile", level: 0.95, valueExpression: "Duration", alias: "P95",
            numberFormat: { output: "duration", factor: 0.000000001 }
          }
        ]
      }
    },
    {
      name: "Latency Percentiles", containerId: "performance",
      x: 0, y: 4, w: 12, h: 6,
      config: {
        displayType: "line",
        sourceId: "${traceSourceId}",
        select: [
          { aggFn: "quantile", level: 0.5,  valueExpression: "Duration", alias: "P50", numberFormat: { output: "duration", factor: 0.000000001 } },
          { aggFn: "quantile", level: 0.95, valueExpression: "Duration", alias: "P95", numberFormat: { output: "duration", factor: 0.000000001 } },
          { aggFn: "quantile", level: 0.99, valueExpression: "Duration", alias: "P99", numberFormat: { output: "duration", factor: 0.000000001 } }
        ]
      }
    },
    {
      name: "Duration Distribution", containerId: "performance",
      x: 12, y: 4, w: 12, h: 6,
      config: {
        displayType: "heatmap",
        sourceId: "${traceSourceId}",
        select: [ { valueExpression: "Duration", heatmapScaleType: "log" } ],
        where: "", whereLanguage: "lucene",
        numberFormat: { output: "duration", factor: 0.000000001 }
      }
    },
    {
      name: "Endpoints", containerId: "endpoints",
      x: 0, y: 10, w: 24, h: 8,
      config: {
        displayType: "table",
        sourceId: "${traceSourceId}",
        select: [
          { aggFn: "count", alias: "Requests" },
          { aggFn: "count", where: "StatusCode:STATUS_CODE_ERROR", whereLanguage: "lucene", alias: "Errors" },
          {
            aggFn: "quantile", level: 0.95, valueExpression: "Duration", alias: "P95 Duration",
            numberFormat: { output: "duration", factor: 0.000000001 }
          }
        ],
        groupBy: "SpanName",
        orderBy: "Requests DESC",
        groupByColumnsOnLeft: true
      }
    },
    {
      name: "Errors Over Time", containerId: "errors",
      x: 0, y: 18, w: 12, h: 6,
      config: {
        displayType: "stacked_bar",
        sourceId: "${traceSourceId}",
        select: [ { aggFn: "count", where: "StatusCode:STATUS_CODE_ERROR", whereLanguage: "lucene", alias: "Errors" } ],
        groupBy: "SpanName"
      }
    },
    {
      name: "Top Error Messages", containerId: "errors",
      x: 12, y: 18, w: 12, h: 6,
      config: {
        displayType: "table",
        sourceId: "${traceSourceId}",
        select: [ { aggFn: "count", alias: "Count" } ],
        groupBy: "StatusMessage",
        having: "StatusMessage != ''",
        orderBy: "Count DESC",
        groupByColumnsOnLeft: true
      }
    },
    {
      name: "Recent Error Spans", containerId: "errors",
      x: 0, y: 24, w: 24, h: 6,
      config: {
        displayType: "search",
        sourceId: "${traceSourceId}",
        select: "Timestamp, ServiceName, SpanName, StatusMessage, SpanAttributes['http.status_code'] AS HttpStatus, Duration",
        where: "StatusCode:STATUS_CODE_ERROR AND StatusMessage:*",
        whereLanguage: "lucene"
      }
    }
  ]
}`;

  examples['log_analytics'] = `
== LOG ANALYTICS ==

When to use: the user is investigating logs, not traces. Trace columns (Duration, SpanName, StatusCode) do NOT apply on a log source. Logs use SeverityText, Body, ServiceName, LogAttributes.

Why this shape: KPIs across the top with severity filters, severity and service breakdown in the middle (stacked_bar + pie + ranked table), recent errors as a search tile at the bottom for drill-down. A dashboard-level filter on ServiceName lets the user narrow to one service.

{
  name: "Log Analytics",
  filters: [
    {
      type: "QUERY_EXPRESSION",
      name: "Service",
      expression: "ServiceName",
      sourceId: "${logSourceId}"
    }
  ],
  containers: [
    { id: "kpis",      title: "Volume",         collapsed: false },
    { id: "breakdown", title: "Breakdown",      collapsed: false },
    { id: "recent",    title: "Recent activity", collapsed: false }
  ],
  tiles: [
    {
      name: "Total logs", containerId: "kpis",
      x: 0, y: 0, w: 8, h: 4,
      config: {
        displayType: "number",
        sourceId: "${logSourceId}",
        select: [ { aggFn: "count", alias: "Total" } ]
      }
    },
    {
      name: "Errors", containerId: "kpis",
      x: 8, y: 0, w: 8, h: 4,
      config: {
        displayType: "number",
        sourceId: "${logSourceId}",
        select: [ { aggFn: "count", where: "SeverityText:error", whereLanguage: "lucene", alias: "Errors" } ]
      }
    },
    {
      name: "Warnings", containerId: "kpis",
      x: 16, y: 0, w: 8, h: 4,
      config: {
        displayType: "number",
        sourceId: "${logSourceId}",
        select: [ { aggFn: "count", where: "SeverityText:warn", whereLanguage: "lucene", alias: "Warnings" } ]
      }
    },
    {
      name: "Volume by severity", containerId: "breakdown",
      x: 0, y: 4, w: 12, h: 6,
      config: {
        displayType: "stacked_bar",
        sourceId: "${logSourceId}",
        select: [ { aggFn: "count", alias: "Events" } ],
        groupBy: "SeverityText"
      }
    },
    {
      name: "Volume by service", containerId: "breakdown",
      x: 12, y: 4, w: 12, h: 6,
      config: {
        displayType: "pie",
        sourceId: "${logSourceId}",
        select: [ { aggFn: "count", alias: "Events" } ],
        groupBy: "ServiceName"
      }
    },
    {
      name: "Top services by error count", containerId: "breakdown",
      x: 0, y: 10, w: 24, h: 8,
      config: {
        displayType: "table",
        sourceId: "${logSourceId}",
        select: [
          { aggFn: "count", alias: "Total logs" },
          { aggFn: "count", where: "SeverityText:error", whereLanguage: "lucene", alias: "Errors" },
          { aggFn: "count", where: "SeverityText:warn",  whereLanguage: "lucene", alias: "Warnings" }
        ],
        groupBy: "ServiceName",
        orderBy: "Errors DESC",
        groupByColumnsOnLeft: true
      }
    },
    {
      name: "Recent errors", containerId: "recent",
      x: 0, y: 18, w: 24, h: 8,
      config: {
        displayType: "search",
        sourceId: "${logSourceId}",
        select: "Timestamp, ServiceName, SeverityText, Body",
        where: "SeverityText:error",
        whereLanguage: "lucene"
      }
    }
  ]
}`;

  examples['backend_dependencies'] = `
== BACKEND DEPENDENCIES ==

When to use: the user wants to see what a backend service calls OUT to (downstream databases, HTTP clients, queues). Filters the trace source by SpanKind to "Client" so every tile reports on outbound spans only.

Why this shape: the per-series where on each aggregation is the right place to scope by SpanKind, because the user may still want to compare the service's own server-side metrics on a different dashboard. The Top downstream operations table is the inventory of dependencies; the trends section shows volume and latency over time.

{
  name: "Backend Dependencies",
  filters: [
    {
      type: "QUERY_EXPRESSION",
      name: "Service",
      expression: "ServiceName",
      sourceId: "${traceSourceId}"
    }
  ],
  containers: [
    { id: "kpis",       title: "Outbound traffic",          collapsed: false },
    { id: "operations", title: "Top downstream operations", collapsed: false },
    { id: "trends",     title: "Trends",                    collapsed: false }
  ],
  tiles: [
    {
      name: "Outbound calls", containerId: "kpis",
      x: 0, y: 0, w: 8, h: 4,
      config: {
        displayType: "number",
        sourceId: "${traceSourceId}",
        select: [ { aggFn: "count", where: "SpanKind:Client", whereLanguage: "lucene", alias: "Client spans" } ]
      }
    },
    {
      name: "Client errors", containerId: "kpis",
      x: 8, y: 0, w: 8, h: 4,
      config: {
        displayType: "number",
        sourceId: "${traceSourceId}",
        select: [ { aggFn: "count", where: "SpanKind:Client AND StatusCode:STATUS_CODE_ERROR", whereLanguage: "lucene", alias: "Errors" } ]
      }
    },
    {
      name: "P95 client duration", containerId: "kpis",
      x: 16, y: 0, w: 8, h: 4,
      config: {
        displayType: "number",
        sourceId: "${traceSourceId}",
        select: [
          {
            aggFn: "quantile", level: 0.95, valueExpression: "Duration",
            where: "SpanKind:Client", whereLanguage: "lucene", alias: "P95",
            numberFormat: { output: "duration", factor: 0.000000001 }
          }
        ]
      }
    },
    {
      name: "RED by downstream operation", containerId: "operations",
      x: 0, y: 4, w: 24, h: 10,
      config: {
        displayType: "table",
        sourceId: "${traceSourceId}",
        select: [
          { aggFn: "count", where: "SpanKind:Client", whereLanguage: "lucene", alias: "Calls" },
          { aggFn: "count", where: "SpanKind:Client AND StatusCode:STATUS_CODE_ERROR", whereLanguage: "lucene", alias: "Errors" },
          {
            aggFn: "quantile", level: 0.95, valueExpression: "Duration",
            where: "SpanKind:Client", whereLanguage: "lucene", alias: "P95 Duration",
            numberFormat: { output: "duration", factor: 0.000000001 }
          }
        ],
        groupBy: "SpanName",
        orderBy: "Calls DESC",
        groupByColumnsOnLeft: true
      }
    },
    {
      name: "Outbound call volume over time", containerId: "trends",
      x: 0, y: 14, w: 12, h: 6,
      config: {
        displayType: "stacked_bar",
        sourceId: "${traceSourceId}",
        select: [ { aggFn: "count", where: "SpanKind:Client", whereLanguage: "lucene", alias: "Calls" } ],
        groupBy: "SpanName"
      }
    },
    {
      name: "Client P95 latency over time", containerId: "trends",
      x: 12, y: 14, w: 12, h: 6,
      config: {
        displayType: "line",
        sourceId: "${traceSourceId}",
        select: [
          {
            aggFn: "quantile", level: 0.95, valueExpression: "Duration",
            where: "SpanKind:Client", whereLanguage: "lucene", alias: "P95",
            numberFormat: { output: "duration", factor: 0.000000001 }
          }
        ],
        groupBy: "SpanName"
      }
    }
  ]
}`;

  examples['drilldown_links'] = `
== ROW-CLICK DRILL-DOWN LINKS ==

A dashboard whose tables are wired up to drill down into either /search
or a more detailed dashboard. Useful when the dashboard answers
"which service?" and the next click should answer "what's happening
inside that service?".

Replace <TARGET_DASHBOARD_ID> with the ID of an existing service-detail
dashboard. Use hyperdx_get_dashboard (no id) to list dashboards and
copy the right ID and discover which filters are available.

{
  name: "Service Drill-Down",
  tags: ["overview", "drilldown"],
  tiles: [
    {
      name: "Errors by Service (click a row to search traces)",
      x: 0, y: 0, w: 12, h: 6,
      config: {
        displayType: "table",
        sourceId: "${traceSourceId}",
        groupBy: "ResourceAttributes['service.name']",
        select: [
          { aggFn: "count", alias: "Errors", where: "StatusCode:STATUS_CODE_ERROR" },
          { aggFn: "count", alias: "Total" }
        ],
        onClick: {
          type: "search",
          target: { mode: "id", id: "${traceSourceId}" },
          whereLanguage: "sql",
          filters: [
            {
              kind: "expressionTemplate",
              expression: "ServiceName",
              template: "{{ResourceAttributes['service.name']}}"
            }
          ]
        }
      }
    },
    {
      name: "Top Endpoints (click a row to open service-detail dashboard)",
      x: 12, y: 0, w: 12, h: 6,
      config: {
        displayType: "table",
        sourceId: "${traceSourceId}",
        groupBy: "ResourceAttributes['service.name']",
        select: [
          { aggFn: "count", alias: "Requests" },
          { aggFn: "quantile", level: 0.95, valueExpression: "Duration", alias: "P95" }
        ],
        // The target dashboard MUST declare a top-level DashboardFilter
        // with expression: "ServiceName" — otherwise the value is dropped.
        // Call hyperdx_get_dashboard(<TARGET_DASHBOARD_ID>) and
        // inspect its filters[] before generating this onClick. If the
        // target doesn't declare it, either update the target to declare
        // ServiceName, or switch to a whereTemplate clause here.
        onClick: {
          type: "dashboard",
          target: { mode: "id", id: "<TARGET_DASHBOARD_ID>" },
          whereLanguage: "sql",
          filters: [
            {
              kind: "expressionTemplate",
              expression: "ServiceName",
              template: "{{ResourceAttributes['service.name']}}"
            }
          ]
        }
      }
    }
  ]
}`;

  examples['infrastructure_sql'] = `
== INFRASTRUCTURE (Raw SQL) ==

When to use: the user wants metric-like infrastructure visibility (request rate, ingestion volume, table sizes) but the builder tile types do not express the exact aggregation. Raw SQL tiles take connectionId (not sourceId) and a sqlTemplate with HyperDX macros.

{
  name: "Infrastructure (SQL)",
  tiles: [
    {
      name: "Log Ingestion Rate Over Time",
      x: 0, y: 0, w: 12, h: 4,
      config: {
        configType: "sql",
        displayType: "line",
        connectionId: "${connectionId}",
        sqlTemplate: "SELECT $__timeInterval(Timestamp) AS ts, count() AS logs_per_interval FROM otel_logs WHERE $__timeFilter(Timestamp) GROUP BY ts ORDER BY ts"
      }
    },
    {
      name: "Top 20 Services by Span Count",
      x: 12, y: 0, w: 12, h: 4,
      config: {
        configType: "sql",
        displayType: "table",
        connectionId: "${connectionId}",
        sqlTemplate: "SELECT ServiceName, count() AS span_count, avg(Duration) AS avg_duration FROM otel_traces WHERE Timestamp >= fromUnixTimestamp64Milli({startDateMilliseconds:Int64}) AND Timestamp < fromUnixTimestamp64Milli({endDateMilliseconds:Int64}) GROUP BY ServiceName ORDER BY span_count DESC LIMIT 20"
      }
    },
    {
      name: "Error Rate by Service (SQL)",
      x: 0, y: 4, w: 24, h: 4,
      config: {
        configType: "sql",
        displayType: "line",
        connectionId: "${connectionId}",
        sqlTemplate: "SELECT $__timeInterval(Timestamp) AS ts, ServiceName, countIf(StatusCode = 'STATUS_CODE_ERROR') / count() AS error_rate FROM otel_traces WHERE $__timeFilter(Timestamp) GROUP BY ServiceName, ts ORDER BY ts"
      }
    }
  ]
}

SQL TEMPLATE REFERENCE:
  Macros (expanded before execution):
    $__timeFilter(col)         col >= <start> AND col <= <end> (DateTime)
    $__timeFilter_ms(col)      same with DateTime64 millisecond precision
    $__dateFilter(col)         same with Date precision
    $__timeInterval(col)       time bucket: toStartOfInterval(toDateTime(col), INTERVAL ...)
    $__timeInterval_ms(col)    same with millisecond precision
    $__fromTime / $__toTime    start/end as DateTime values
    $__fromTime_ms / $__toTime_ms  start/end as DateTime64 values
    $__interval_s              raw interval in seconds
    $__filters                 dashboard filter conditions (resolves to 1=1 when none)

  Query parameters:
    {startDateMilliseconds:Int64}  start of date range in milliseconds
    {endDateMilliseconds:Int64}    end of date range in milliseconds
    {intervalSeconds:Int64}        time bucket size in seconds
    {intervalMilliseconds:Int64}   time bucket size in milliseconds

  Available parameters by displayType:
    line / stacked_bar        startDate, endDate, interval (all available)
    table / number / pie      startDate, endDate only (no interval)`;

  const preface =
    'Concrete dashboard examples for common observability patterns. ' +
    'These are PATTERNS to adapt, not literal templates. Adapt the structure ' +
    "(table shape, container layout, filter expression) to the user's request; " +
    'always verify column names and status literals via hyperdx_list_sources before reusing them.\n' +
    'Replace ${sourceId} / ${connectionId} placeholders with real IDs from hyperdx_list_sources.\n\n';

  if (pattern) {
    const key = pattern.toLowerCase().replace(/[\s-]+/g, '_');
    const matched = Object.entries(examples).find(([k]) => k === key);
    if (matched) {
      return `${preface}Dashboard example for pattern: ${pattern}\n${matched[1]}`;
    }
    return (
      `No example found for pattern "${pattern}". Available patterns: ${Object.keys(examples).join(', ')}\n\n` +
      preface +
      Object.values(examples).join('\n')
    );
  }

  return (
    preface +
    `Available patterns: ${Object.keys(examples).join(', ')}\n` +
    Object.values(examples).join('\n')
  );
}

export function buildQueryGuidePrompt(): string {
  return `Reference guide for writing queries with HyperDX MCP tools (hyperdx_timeseries, hyperdx_table, hyperdx_search, hyperdx_event_patterns, hyperdx_sql, and hyperdx_save_dashboard).

== AGGREGATION FUNCTIONS (aggFn) ==

  count          Count matching rows. Does NOT take a valueExpression.
  sum            Sum of a numeric column. Requires valueExpression.
  avg            Average of a numeric column. Requires valueExpression.
  min            Minimum value. Requires valueExpression.
  max            Maximum value. Requires valueExpression.
  count_distinct Count of unique values. Requires valueExpression.
  quantile       Percentile value. Requires valueExpression AND level (0.5, 0.9, 0.95, or 0.99).
  last_value     Most recent value of a column. Requires valueExpression.
  none           Pass a raw expression unchanged. Requires valueExpression.
  heatmap        Heatmap-only literal. Requires non-empty valueExpression. Used exclusively in heatmap tiles.

Examples:
  { aggFn: "count" }
  { aggFn: "avg", valueExpression: "Duration" }
  { aggFn: "quantile", valueExpression: "Duration", level: 0.95 }
  { aggFn: "count_distinct", valueExpression: "ResourceAttributes['service.name']" }
  { aggFn: "sum", valueExpression: "Duration", where: "StatusCode:STATUS_CODE_ERROR" }
  { valueExpression: "Duration" }  // heatmap tile only (no aggFn; chart-level displayType is the discriminator)

== COLUMN NAMING ==

Top-level columns (PascalCase defaults, use directly in valueExpression and groupBy):
  Duration, StatusCode, SpanName, ServiceName, SpanKind, Body, SeverityText,
  Timestamp, TraceId, SpanId, ParentSpanId
  NOTE: These are defaults for the standard HyperDX schema. Custom sources may
  use different column names. Always verify with hyperdx_list_sources, which returns
  the real column names and keyColumns expressions for each source.

Map-type columns (bracket syntax, access keys via ['key']):
  SpanAttributes['http.method']
  SpanAttributes['http.route']
  SpanAttributes['http.status_code']
  ResourceAttributes['service.name']
  ResourceAttributes['deployment.environment']

IMPORTANT: Always use bracket syntax for Map-type columns. Never use dot notation for Maps.
  Correct:   SpanAttributes['http.method']
  Incorrect: SpanAttributes.http.method

JSON-type columns (dot notation, access nested keys via dot path):
  JsonColumn.key.subkey
  NOTE: Check the jsType field returned by hyperdx_list_sources to decide
  whether a column is Map (use brackets) or JSON (use dots).

== LUCENE FILTER SYNTAX ==

Used in the "where" field of select items and search tiles.

  Basic match:        level:error
  AND:                service.name:api AND http.status_code:>=500
  OR:                 level:error OR level:fatal
  NOT:                NOT level:debug
  Wildcard:           service.name:front*
  Phrase:             Body:"connection refused"
  Exists:             _exists_:http.route
  Range (numeric):    Duration:>1000000000
  Range (inclusive):  http.status_code:[400 TO 499]
  Grouped:            (level:error OR level:fatal) AND service.name:api

NOTE: In Lucene filters, use dot notation for attribute keys (service.name, http.method).
This is different from valueExpression and groupBy which require bracket syntax (SpanAttributes['http.method']).

== SQL FILTER SYNTAX ==

Alternative to Lucene. Set whereLanguage: "sql" when using SQL syntax.

  Basic:              SeverityText = 'error'
  AND/OR:             ServiceName = 'api' AND StatusCode = 'STATUS_CODE_ERROR'
  IN:                 ServiceName IN ('api', 'web', 'worker')
  LIKE:               Body LIKE '%timeout%'
  Comparison:         Duration > 1000000000
  Map access:         SpanAttributes['http.status_code'] = '500'

== RAW SQL TEMPLATES ==

For configType: "sql" tiles, write ClickHouse SQL with template macros:

  MACROS (expanded before execution):
    $__timeFilter(col)         col >= <start> AND col <= <end>
    $__timeFilter_ms(col)      same with DateTime64 millisecond precision
    $__dateFilter(col)         same with Date precision
    $__dateTimeFilter(d, t)    filters on both Date and DateTime columns
    $__timeInterval(col)       time bucket expression for GROUP BY
    $__timeInterval_ms(col)    same with millisecond precision
    $__fromTime / $__toTime    start/end as DateTime values
    $__fromTime_ms / $__toTime_ms  start/end as DateTime64 values
    $__interval_s              raw interval in seconds (for arithmetic)
    $__filters                 dashboard filter conditions (1=1 when none)

  QUERY PARAMETERS (ClickHouse parameterized syntax):
    {startDateMilliseconds:Int64}
    {endDateMilliseconds:Int64}
    {intervalSeconds:Int64}
    {intervalMilliseconds:Int64}

  TIME-SERIES EXAMPLE (line / stacked_bar):
    SELECT
      $__timeInterval(Timestamp) AS ts,
      ServiceName,
      count() AS requests
    FROM otel_traces
    WHERE $__timeFilter(Timestamp)
    GROUP BY ServiceName, ts
    ORDER BY ts

  TABLE EXAMPLE:
    SELECT
      ServiceName,
      count() AS request_count,
      avg(Duration) AS avg_duration,
      quantile(0.95)(Duration) AS p95_duration
    FROM otel_traces
    WHERE Timestamp >= fromUnixTimestamp64Milli({startDateMilliseconds:Int64})
      AND Timestamp < fromUnixTimestamp64Milli({endDateMilliseconds:Int64})
    GROUP BY ServiceName
    ORDER BY request_count DESC
    LIMIT 50

  IMPORTANT: Always include a LIMIT clause in table / number / pie SQL queries.

== PER-TILE TYPE CONSTRAINTS ==

  number       Exactly 1 select item. No groupBy.
  pie          Exactly 1 select item. groupBy defines the slices. Keep slice count under 8.
  line         1 to 20 select items. Optional groupBy splits into series. Each select item may carry its own numberFormat.
  stacked_bar  1 to 20 select items. Optional groupBy splits into stacks.
  table        1 to 20 select items. Optional groupBy defines row groups. Per-series numberFormat lets one column render as a duration while a sibling count column stays a plain number.
  heatmap      Exactly 1 select item with a non-empty valueExpression. No aggFn or alias on the select item (the chart-level displayType: "heatmap" is the discriminator). Trace sources only (no Log/Metric/Session). No groupBy. Optional where filter applied before bucketing.
  search       No select items (select is a column list string). where is the filter.
  markdown     No select items. Set markdown field with content.

  METRIC TILES (any of the above with metric source): exactly 1 select item with metricName + metricType (gauge / sum / histogram). To show multiple metrics side by side, create one tile per metric.

== NUMBER FORMAT ==

numberFormat controls how a value renders. Two places to set it:

  Per-series (on each select item): { output: "...", factor: ... } on a single select. Other series in the same tile keep their default rendering. USE THIS for tables and line charts that mix count and duration columns.

  Chart-level (on tile config): same shape on the tile config root. Applies to every value in the tile. USE THIS for number, heatmap, and tiles where every series shares a unit.

Common outputs:
  duration   Auto-formats elapsed time as "1.2s" / "200ms". Use factor: 0.000000001 for nanosecond Duration columns.
  byte       Auto-formats as KB / MB / GB.
  percent    Multiplies by 100 and appends %.
  number     Plain number. Set thousandSeparated: true for "1,234,567" and average: true for "1.2m" abbreviation.
  currency   Prepends currencySymbol.
  data_rate  Bytes per second.
  throughput Count per second.

== asRatio ==

Set asRatio: true on line / stacked_bar / table tiles with exactly 2 select items
to plot the first as a ratio of the second. Useful for error rates:
  select: [
    { aggFn: "count", where: "StatusCode:STATUS_CODE_ERROR", alias: "Errors" },
    { aggFn: "count", alias: "Total" }
  ],
  asRatio: true

== DASHBOARD FILTERS ==

Optional dashboard-level filter declarations. Each entry adds a dropdown to the dashboard header that scopes every tile against the same source. Use this for focused per-dimension dashboards (per-service, per-tenant, per-endpoint) instead of hardcoding the dimension into every tile's where clause.

Filter shape:
  { type, name, expression, sourceId, where?, whereLanguage? }

  type             "QUERY_EXPRESSION" (the only currently supported type).
  name             Human label shown in the filter dropdown (e.g. "Service").
  expression       Column or attribute path the filter scopes (e.g. "ServiceName" or "SpanAttributes['tenant.id']").
  sourceId         Which source the expression resolves against. Tiles on a different source are NOT scoped by the filter.
  where            Optional pre-filter that narrows the set of distinct values offered in the dropdown.
  whereLanguage    "lucene" or "sql". Defaults to "lucene".

Example:
  filters: [
    { type: "QUERY_EXPRESSION", name: "Service", expression: "ServiceName", sourceId: "<trace-source-id>" }
  ]

When a value is picked in the dropdown, the renderer combines it with each tile's existing where clause via AND. Tiles do NOT need to reference the filter name; the source match alone is enough.

== CONTAINERS AND TABS ==

Optional dashboard organization layer. Group related tiles visually with optional tab bars. Pass on hyperdx_save_dashboard as a top-level "containers" array; reference containers from tiles via "containerId" (and "tabId" when the container has tabs).

Container shape:
  { id, title, collapsed, collapsible?, bordered?, tabs? }

  id            Required, non-empty.
  title         Required, non-empty. Shown as the group header.
  collapsed     Required boolean. Starts collapsed when true.
  collapsible   Optional boolean. Defaults to true. When false the group header has no toggle.
  bordered      Optional boolean. Defaults to true.
  tabs          Optional array of { id, title }. Zero or one tab renders as a plain group header; two or more render as a tab bar.

Tile fields (on the same tile shape used in tiles[]):
  containerId   Optional. Must match an id in containers[].
  tabId         Optional. Must match a tab id on that container. Requires containerId. A tile with containerId set but no tabId renders in the container shell (above any tab bar).

Rules enforced by the API:
  - Container ids must be unique on a dashboard.
  - Tab ids must be unique within a container.
  - A tile's containerId must reference a real container in the array.
  - A tile's tabId must reference a real tab on that container.
  - A tile's tabId requires containerId to be set.

Example:
  hyperdx_save_dashboard({
    name: "Service Overview",
    containers: [
      {
        id: "service-health",
        title: "Service Health",
        collapsed: false,
        tabs: [
          { id: "errors",  title: "Errors"  },
          { id: "latency", title: "Latency" }
        ]
      },
      { id: "overview", title: "Overview", collapsed: true }
    ],
    tiles: [
      { name: "Error Rate", containerId: "service-health", tabId: "errors",
        config: { displayType: "line", sourceId: "<id>", select: [{ aggFn: "count" }] } },
      { name: "Throughput", containerId: "overview",
        config: { displayType: "line", sourceId: "<id>", select: [{ aggFn: "count" }] } },
      { name: "Latest Logs",
        config: { displayType: "search", sourceId: "<id>" } }
    ]
  })

Validation errors on bad inputs:
  - tile.containerId references a missing container id
  - tile.tabId references a missing tab id on that container
  - tile.tabId set without tile.containerId
  - duplicate container.id within the dashboard
  - duplicate tab.id within a single container

The server returns a descriptive error string identifying the failing path
(tiles[i].containerId, tiles[i].tabId, containers[i].id, or
containers[i].tabs[j].id). Read the path to know which input to fix.

== EVENT PATTERN MINING ==

Use hyperdx_event_patterns when asked to find common log messages, recurring
patterns, noisy services, or top event types. This is the right choice whenever
the question is about "most common logs", "top patterns", "what is generating
the most log volume", or similar pattern-discovery questions.

It samples random events and clusters them with the Drain algorithm, returning:
  - pattern templates (with <*> wildcards for variable parts)
  - estimated counts (scaled from the sample to the full time range)
  - time-bucketed trends
  - a whereSnippet for each pattern to drill into matching raw events

Required parameters:
  - sourceId (call hyperdx_list_sources first)
  - startTime / endTime for the time window

Optional parameters:
  - where — filter to specific services or severity levels before mining
  - sampleSize — increase for more accurate patterns (default 10000, max 25000)
  - bodyExpression — column to mine (auto-detected: Body for logs, SpanName for traces)

Example: find top patterns for production services over the last 4 hours:
  hyperdx_event_patterns({
    sourceId: "<log-source-id>",
    startTime: "<4 hours ago ISO>",
    endTime: "<now ISO>",
    where: "service.name:prod-*"
  })

== COMMON MISTAKES ==

1. Using valueExpression with aggFn "count"
   Wrong:   { aggFn: "count", valueExpression: "Duration" }
   Correct: { aggFn: "count" }

2. Forgetting valueExpression for non-count aggFns
   Wrong:   { aggFn: "avg" }
   Correct: { aggFn: "avg", valueExpression: "Duration" }

3. Using dot notation for Map-type attributes in valueExpression or groupBy
   Wrong:   groupBy: "SpanAttributes.http.method"
   Correct: groupBy: "SpanAttributes['http.method']"
   NOTE: JSON-type columns DO use dot notation. Check jsType from hyperdx_list_sources.

4. Multiple select items on number / pie / heatmap / metric tiles
   Wrong:   displayType: "number", select: [{ aggFn: "count" }, { aggFn: "avg", ... }]
   Correct: displayType: "number", select: [{ aggFn: "count" }]
   Same constraint applies to metric source tiles: one tile per metric.
   Note: hyperdx_table (the query tool) auto-upgrades shape:"number" to "table" when select has >1 item; dashboard tiles do not.

5. Missing level for quantile
   Wrong:   { aggFn: "quantile", valueExpression: "Duration" }
   Correct: { aggFn: "quantile", valueExpression: "Duration", level: 0.95 }

6. Chart-level numberFormat on a table that mixes counts and durations
   Wrong:   table with select: [count, count, quantile(Duration)] and chart-level numberFormat: { output: "duration", ... }
   Correct: put numberFormat on the quantile(Duration) select item only.
   The chart-level form applies to every value, so count columns render as "0:00:00" / "0s".

7. Hardcoding a focus dimension into every tile's where clause
   Wrong:   five tiles, each with where: "ServiceName:checkout"
   Correct: filters: [{ type: "QUERY_EXPRESSION", name: "Service", expression: "ServiceName", sourceId: "<id>" }]
   The dashboard filter applies globally; tiles do not need the literal.

8. Forgetting to validate tiles after saving
   Always call hyperdx_query_tile after hyperdx_save_dashboard to verify each tile returns data.

9. Using sourceId with SQL tiles or connectionId with builder tiles
   Builder tiles (line, table, etc.) use sourceId.
   SQL tiles (configType: "sql") use connectionId.

10. Assuming StatusCode or SeverityText values
    Values like STATUS_CODE_ERROR, Ok, error, fatal vary by deployment.
    Always call hyperdx_list_sources and inspect real keyValues from the source
    before writing filters that depend on these columns.

11. Heatmap tile on a non-Trace source
    Wrong:   { displayType: "heatmap", sourceId: "<log-source-id>", select: [...] }
    Correct: { displayType: "heatmap", sourceId: "<trace-source-id>", select: [...] }
    Heatmap is currently restricted to Trace sources. Pick a source whose kind is "trace" from hyperdx_list_sources.

12. Heatmap tile with empty or missing valueExpression
    Wrong:   select: [{}]
    Wrong:   select: [{ valueExpression: "" }]
    Correct: select: [{ valueExpression: "Duration" }]
    Heatmap requires a non-empty numeric column or expression to bucket.

11. onClick on a non-table tile
    Only table tiles (builder displayType: "table" and raw-SQL configType: "sql"
    with displayType: "table") support config.onClick. Other displayTypes
    ignore the field. Putting onClick on a line/number/pie/heatmap/search/markdown
    tile won't error but won't do anything either.

12. onClick targeting a non-log/trace source for type="search"
    The /search page only renders log and trace sources. Targeting a
    metric or session source is rejected at save time with:
    "The following onClick search source IDs are not log or trace sources: ..."

13. Missing whereLanguage on onClick
    whereLanguage is technically optional, but should still be set to
    "lucene" or "sql" so the destination knows how to parse rendered
    whereTemplate / filter values. Leaving it unset can cause the
    destination to fall back to its own default.

14. Templating against a column that isn't in the table's select/groupBy
    Templates like "{{ServiceName}}" pull from the clicked row's columns.
    If the column doesn't appear in the table query, the template renders
    as empty at click time and the destination opens unfiltered. Match
    {{column}} names to columns produced by the table (group-by columns
    and aliases both work).

15. onClick (type="dashboard") filter expression not declared on the target
    For a dashboard target, each entry in onClick.filters[] only takes
    effect when the destination dashboard declares a top-level
    DashboardFilter with the SAME \`expression\`. The renderer drops URL
    filter entries whose expression isn't in the destination's declared
    filter set — so the user lands on the destination unfiltered.
    Before generating an onClick.filters entry, call
    hyperdx_get_dashboard on the target and confirm its
    \`filters[].expression\` list. If the expression isn't there, either:
      a) declare it on the target dashboard's top-level \`filters\` array
         (passed to hyperdx_save_dashboard), or
      b) use \`whereTemplate\` instead, which doesn't require a declared
         filter on the target."`;
}
