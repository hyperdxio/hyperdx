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

IMPORTANT: Call clickstack_list_sources first to get source IDs, then clickstack_describe_source for each source you plan to query. This gives you the full column schema, attribute keys, and sampled values (e.g. SeverityText, StatusCode). The source IDs above are correct, but you need the schema details to write accurate queries.

== WORKFLOW ==

1. Call clickstack_list_sources to discover source IDs and connection IDs.
2. Call clickstack_describe_source for each source you plan to query to get column schema, attribute keys, and sampled low-cardinality values (SeverityText, StatusCode, ServiceName, etc.).
3. Call clickstack_get_dashboard (no id) to list existing dashboards. If any exist, fetch one or two with their id and skim them to pick up local idioms (naming style, time ranges, common groupings) before adding new ones. Skip when the workspace is empty.
4. Pick the right source kind for the question. Trace data for request volume / latency / errors. Log data for severity / messages. Metric data for system telemetry.
5. Sketch tiles, THEN group them into 2-4 containers (Overview / Trends / Errors is a sane default for a service-health pattern) before assembling the save payload. Ungrouped tiles render as a flat sprawl that fails the readability test at five or more tiles.
6. Call clickstack_save_dashboard with the tiles, containers, and dashboard-level filters.
7. Call clickstack_query_tile on EVERY tile (not just one) to confirm queries return data and the dashboard is not silently degraded.

== UPDATING AN EXISTING DASHBOARD ==

When updating a dashboard (passing the top-level \`id\` to clickstack_save_dashboard),
the \`filters\` array must be fully self-describing: every filter needs an \`id\`:

  - Existing filter you are KEEPING: copy its \`id\` verbatim from the
    clickstack_get_dashboard response. The same applies if you are renaming
    or tweaking it. This preserves any savedFilterValues bound to that id.
  - New filter you are ADDING in this update: generate a fresh random
    24-character hex string (a Mongo-style ObjectId) and set it as \`id\`.
    Do not reuse an existing filter's id and do not leave \`id\` blank.
    omitting it would force the server to generate one and obscure the
    new filter's identity from your own bookkeeping.
  - Existing filter you are REMOVING: drop it from the array entirely.

Recommended pattern:

  1. \`clickstack_get_dashboard({ id })\` to capture the current \`filters[]\`
     and their ids.
  2. Build the new array: spread the kept filters as-is, append new
     filters with freshly-minted ids, omit removed ones.
  3. \`clickstack_save_dashboard({ id, ..., filters: <new array> })\`.

== TILE TYPE GUIDE ==

Use BUILDER tiles (with sourceId) for most cases:
  line         Time-series trends (error rate, request volume, latency over time).
  stacked_bar  Compare categories over time (requests by service, errors by status code).
  number       Single KPI metric (total requests, current error rate, p99 latency).
  table        Ranked lists (top endpoints by latency, error counts by service). Tables can wire row-click navigation via config.onClick to the /search page or another dashboard. See "TABLE TILE LINKING" below.
  pie          Proportional breakdowns (traffic share by service, errors by type). Keep slice count under 8.
  heatmap      Distribution of a numeric value over time (latency buckets, payload size). Trace sources only. Requires non-empty valueExpression.
  search       Browse raw log/event rows (error logs, recent traces).
  markdown     Use sparingly. The dashboard already shows its name in the title bar at the top; do NOT add a "About this dashboard" tile that repeats it. Markdown bodies render h1/h2/h3 headings at title-bar scale, so a single \`## Service Catalog\` line eats most of the tile and pushes real KPIs below the fold. Skip markdown tiles for starter dashboards. If you must add one, use h: 1, plain prose, no \`#\`/\`##\`/\`###\` headings. Use containers/tabs for section grouping instead.

Use RAW SQL tiles (with connectionId) only for queries the builder cannot express:
  Requires configType: "sql" plus a displayType (line, stacked_bar, table, number, pie).
  Use when you need JOINs, sub-queries, CTEs, or expressions the builder does not generate.
  ALWAYS set sourceId on a raw SQL tile (in addition to connectionId) UNLESS the query reads
  from multiple tables (e.g. JOINs across sources). sourceId enables the $__filters and 
  $__sourceTable macros. When you can set sourceId, include "AND $__filters" in the WHERE clause.

== COLUMN NAMING ==

- Top-level columns use PascalCase by default: Duration, StatusCode, SpanName, Body, SeverityText, ServiceName, SpanKind.
  NOTE: These are defaults for the standard HyperDX schema. Custom sources may use different names.
  Always call clickstack_describe_source to get the real column names, keyColumns, and sampled values for each source.
- Map-type columns use bracket syntax: SpanAttributes['http.method'], ResourceAttributes['service.name'].
  NEVER use dot notation for Map columns. Always use brackets.
- JSON-type columns use dot notation: JsonColumn.key.subkey.
  Check the jsType returned by clickstack_describe_source to determine whether a column is Map or JSON.

== DESIGN CHECKLIST ==

Apply these before calling clickstack_save_dashboard. Each rule is enforced by the renderer; ignoring one is a runtime error you will then need to fix.

1. ONE QUESTION PER DASHBOARD. A dashboard answers a single observability question well. Split if the request mixes traces, logs, and metrics into unrelated views.

2. ALIAS EVERY SELECT ITEM. Every entry in select MUST carry an alias. Tables, lines, stacked_bars, pies, AND number tiles. The number-tile case is the one most often missed because the rendered UI uses the tile's name (not the column alias), so the absence looks invisible; the underlying query still emits a raw-expression column name (count(), quantile(0.95)(Duration)), which breaks orderBy references, CSV export, and any downstream onClick template that references the column by name. Treat "no alias" as a save-time bug, not a style nit. Heatmap is the only exception: heatmap select items take a valueExpression and no alias.

   Number tile, correct:    select: [{ aggFn: "count", alias: "Server Requests" }]
   Number tile, wrong:      select: [{ aggFn: "count" }]
   Quantile (number/table): select: [{ aggFn: "quantile", level: 0.95, valueExpression: "Duration", alias: "P95 Duration" }]

3. GROUP BY HAS NO ALIAS HOOK. The chart config's groupBy is a single expression string and the renderer uses it verbatim as the column header (tables) and as the raw column name everywhere else (CSV export, tooltips, orderBy references, onClick template references). Grouping a table by SpanAttributes['http.route'] produces a column header that reads literally as arrayElement(SpanAttributes, 'http.route'). When a top-level column carries the same semantic, prefer it: SpanName for operation, ServiceName for service, SeverityText for log severity. When the dimension exists only as a Map attribute and the column header matters, drop to a raw SQL tile (configType: "sql") and write the column with AS alias. Line, stacked_bar, and pie tiles legend by the value not the column name, so the issue is invisible on the chart itself but still bites CSV export and onClick template references.

4. INVENTORY-STYLE TABLES PUT THE GROUP BY ON THE LEFT. Set groupByColumnsOnLeft: true on tables that read like a list of things (one row per service, per endpoint, per tenant).

5. RED COLUMNS FOR SERVICE / ENDPOINT TABLES. Request rate (count), Error rate (count with where: "StatusCode:STATUS_CODE_ERROR"), Duration (quantile P95 on the Duration column). Three columns, all aliased.

6. PER-SERIES NUMBER FORMAT FOR DURATIONS. Put numberFormat on each select item that needs special rendering. Example: { output: "duration", factor: 0.000000001 } on a Duration percentile. NEVER set chart-level numberFormat for tables that mix counts and durations; the count columns will render as 0:00:00.

7. LINE CHARTS CAN PASS UP TO 20 SELECT ITEMS. Plot related metrics together (p50, p95, p99 on one chart). Each series can carry its own numberFormat.

8. HEATMAPS FOR DISTRIBUTIONS. Trace duration buckets, payload size buckets. Trace sources only. Set numberFormat: { output: "duration", factor: 0.000000001 } on the chart config so the y-axis reads in human time.

9. FOR FOCUSED PER-DIMENSION DASHBOARDS, DECLARE A DASHBOARD-LEVEL FILTER. Pass filters: [{ type: "QUERY_EXPRESSION", name, expression, sourceId }] at the top level. The user gets a dropdown in the dashboard header; by default every tile is re-scoped when a value is picked. On mixed-source dashboards add appliesToSourceIds: ["<id>", ...] to restrict the filter to only the tiles whose source carries that column. Omit the field to keep the broadcast-to-all-tiles default. Do NOT hardcode the dimension into each tile's where clause.

10. UPDATE IS REPLACE, NOT MERGE. clickstack_save_dashboard with an id overwrites tiles, containers, and filters in their entirety. Call clickstack_get_dashboard first when you only want to add or rename one entry; do not send a partial set or you will silently drop everything you omitted.

11. GROUP RELATED TILES INTO CONTAINERS. REQUIRED at five or more tiles, no exceptions. An ungrouped wall of nine or ten tiles is a readability failure even when each tile is correct in isolation. Containers are the right way to introduce structure; markdown tiles for section labels are not.

   Concrete shape (copy this directly into the save payload):
     containers: [
       { id: "kpis",   title: "KPIs",   collapsed: false },
       { id: "trends", title: "Trends", collapsed: false },
       { id: "errors", title: "Errors", collapsed: false }
     ]
   Reference container ids from each tile:
     tiles: [
       { name: "Server Requests", containerId: "kpis",   config: { displayType: "number", select: [{ aggFn: "count", alias: "Server Requests" }], ... } },
       { name: "Latency p95",     containerId: "trends", config: { displayType: "line",   select: [{ aggFn: "quantile", level: 0.95, valueExpression: "Duration", alias: "P95" }], ... } }
     ]
   Use tabs when one container needs to show different views of the same data (Throughput / Latency / Errors over time, for instance); the tab bar appears when a container has two or more tabs declared.

12. VALIDATE EVERY TILE AFTER SAVE. After clickstack_save_dashboard, call clickstack_query_tile on EVERY tile (not just one). Save validates input shape; it does NOT validate query semantics. Some queries pass save and fail at render time (known gaps: Lucene comparison/wildcard on map attributes, metric tiles with multiple metricTables, malformed having clauses). If query_tile returns an error, fix the tile and re-save before declaring the dashboard ready.

13. NO TITLE-RECAP MARKDOWN TILE. The dashboard's name shows in the title bar. Adding a markdown tile with the dashboard name (or a "About this dashboard" header) doubles the title and eats a row of vertical space because markdown heading styles render at title-bar scale. Skip the markdown tile entirely on starter dashboards.

== ADAPT, DO NOT COPY ==

The dashboard_examples prompt returns concrete example shapes. Read them as patterns to adapt to the user's actual request and schema, not as literal templates to substitute names into. Specifically: the literal "ServiceName", "StatusCode:STATUS_CODE_ERROR", "Duration" come from the standard HyperDX schema. Real source schemas may use different column names and status values; always verify with clickstack_list_sources before reusing literals.

IMPORTANT: The exact values for StatusCode and SeverityText vary by deployment.
Do NOT assume values like "STATUS_CODE_ERROR", "Ok", "error", or "fatal".
Always call clickstack_describe_source first and inspect the lowCardinalityValues
returned for each source to discover the real values used in your data.

== DEFAULT TIME WINDOW ==

Dashboards open with a 15-minute default window. There is no dashboard-level field to change this default today; it is a user-side control in the header. For overview / starter dashboards on intermittent or batch-ingested data, the 15-minute window may show empty tiles even when the queries are correct. After save, tell the user the default is 15 minutes and that widening to 1h or 24h is the first thing to try if a tile looks empty. Do NOT compensate by hardcoding a wider time range into individual tiles; that desynchronizes them from the dashboard time picker.

== COMMON MISTAKES TO AVOID ==

- Using valueExpression with aggFn "count" (count takes no valueExpression).
- Forgetting valueExpression for non-count aggFns (avg, sum, min, max, quantile all require it).
- Using dot notation for Map-type attributes (always use SpanAttributes['key'] bracket syntax).
- Skipping clickstack_list_sources + clickstack_describe_source (you need real source IDs, column names, and values).
- Skipping clickstack_query_tile after save (tiles can silently fail on syntax or attribute mismatches).
- Setting chart-level numberFormat on a table that mixes counts and durations (counts render as 0:00:00).
- Multiple select items on number / pie / heatmap tiles (each takes exactly one).
- Missing level on aggFn "quantile" (must specify 0.5, 0.9, 0.95, or 0.99).
- Assuming StatusCode or SeverityText values (always inspect lowCardinalityValues from clickstack_describe_source).
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

Pairing: the Services table wires row-click to drill into a partner per-service dashboard. The canonical partner is the "service_detail" pattern saved as "Service Detail"; clicking a service row opens it with the ServiceName filter pre-populated to that row's value. Save the service_detail dashboard FIRST (or alongside) so the partner exists when a user clicks; mode: "template" resolves by name at click time, so a missing partner shows an error toast instead of navigating. If the user renames the detail dashboard, update the onClick template to match.

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
        groupByColumnsOnLeft: true,
        // Row-click drills into the partner "Service Detail" dashboard.
        // The detail dashboard declares filter expression "ServiceName";
        // expression here MUST match for the destination's dropdown to
        // auto-populate. {{ServiceName}} pulls the clicked row's
        // ServiceName column value (set by groupBy above).
        onClick: {
          type: "dashboard",
          target: { mode: "template", template: "Service Detail" },
          whereLanguage: "sql",
          filters: [
            {
              kind: "expressionTemplate",
              expression: "ServiceName",
              template: "{{ServiceName}}"
            }
          ]
        }
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
dashboard. Use clickstack_get_dashboard (no id) to list dashboards and
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

When to use: the user wants metric-like infrastructure visibility (request rate, ingestion volume, table sizes) but the builder tile types do not express the exact aggregation. Raw SQL tiles take connectionId, a sqlTemplate with HyperDX macros, and (when the query reads a single table) a sourceId. Set sourceId and add "AND $__filters" so dashboard filters apply.

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
        sourceId: "${logSourceId}",
        sqlTemplate: "SELECT $__timeInterval(Timestamp) AS ts, count() AS logs_per_interval FROM otel_logs WHERE $__timeFilter(Timestamp) AND $__filters GROUP BY ts ORDER BY ts"
      }
    },
    {
      name: "Top 20 Services by Span Count",
      x: 12, y: 0, w: 12, h: 4,
      config: {
        configType: "sql",
        displayType: "table",
        connectionId: "${connectionId}",
        sourceId: "${traceSourceId}",
        sqlTemplate: "SELECT ServiceName, count() AS span_count, avg(Duration) AS avg_duration FROM otel_traces WHERE Timestamp >= fromUnixTimestamp64Milli({startDateMilliseconds:Int64}) AND Timestamp < fromUnixTimestamp64Milli({endDateMilliseconds:Int64}) AND $__filters GROUP BY ServiceName ORDER BY span_count DESC LIMIT 20"
      }
    },
    {
      name: "Error Rate by Service (SQL)",
      x: 0, y: 4, w: 24, h: 4,
      config: {
        configType: "sql",
        displayType: "line",
        connectionId: "${connectionId}",
        sourceId: "${traceSourceId}",
        sqlTemplate: "SELECT $__timeInterval(Timestamp) AS ts, ServiceName, countIf(StatusCode = 'STATUS_CODE_ERROR') / count() AS error_rate FROM otel_traces WHERE $__timeFilter(Timestamp) AND $__filters GROUP BY ServiceName, ts ORDER BY ts"
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
    $__filters                 dashboard filter conditions (resolves to 1=1 when none).
                               REQUIRES sourceId on the tile. Without it, filters never apply.
    $__sourceTable             the source's \`database\`.\`table\`.
                               REQUIRES sourceId on the tile. Without it, the query fails to run.

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
    'always verify column names and status literals via clickstack_list_sources before reusing them.\n' +
    'Replace ${sourceId} / ${connectionId} placeholders with real IDs from clickstack_list_sources.\n\n';

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
  return `Reference guide for writing queries with ClickStack MCP tools (clickstack_timeseries, clickstack_table, clickstack_search, clickstack_event_patterns, clickstack_sql, and clickstack_save_dashboard).

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
  use different column names. Always verify with clickstack_describe_source, which returns
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
  NOTE: Check the jsType field returned by clickstack_describe_source to determine
  whether a column is Map (use brackets) or JSON (use dots).

== LUCENE FILTER SYNTAX ==

Used in the "where" field of select items and search tiles.

  Basic match:        level:error
  AND:                service.name:api AND http.status_code:>=500
  OR:                 level:error OR level:fatal
  NOT:                NOT level:debug
  Wildcard:           ServiceName:front*
  Phrase:             Body:"connection refused"
  Exists:             _exists_:http.route
  Range (numeric):    Duration:>1000000000
  Range (inclusive):  http.status_code:[400 TO 499]
  Grouped:            (level:error OR level:fatal) AND service.name:api

NOTE: In Lucene filters, use dot notation for attribute keys (service.name, http.method).
This is different from valueExpression and groupBy which require bracket syntax (SpanAttributes['http.method']).

*** SUBSTRING MATCHING (field:value and field:value*) ***

Lucene field:value does NOT mean exact equality. It translates to ilike(field, '%value%') -- a case-insensitive SUBSTRING match. This has two major consequences:

  1. Plain value is a substring search:
     SpanKind:Server     matches "Server", "ServerStreaming", "InternalServer", etc.
     SeverityText:error  matches "error", "error_timeout", "critical_error", etc.

  2. Trailing wildcard (field:val*) is prefix-within-substring, NOT a true prefix match:
     ServiceName:api*    does NOT mean "starts with api". It means "contains a substring starting with api".
                         In practice this often works for prefix matching, but it is NOT equivalent to SQL LIKE 'api%'.

  For exact matching or true prefix/suffix/contains patterns, use SQL instead:
     Exact:    whereLanguage: "sql", where: "SpanKind = 'Server'"
     Prefix:   whereLanguage: "sql", where: "ServiceName LIKE 'api%'"
     Contains: whereLanguage: "sql", where: "Body LIKE '%timeout%'"
     Regex:    whereLanguage: "sql", where: "match(ServiceName, '^api-v[0-9]+')"

  When Lucene substring matching is FINE: free-text columns like Body, StatusMessage where substring is the intent.
  When Lucene substring matching is WRONG: enum-like columns (SpanKind, SeverityText, StatusCode, ServiceName) where you want exact or true prefix match.

*** MAP-ATTRIBUTE GOTCHA ***

Lucene queries that reference map-attribute keys via dotted paths (http.status_code, db.system, deployment.environment, anything under SpanAttributes / ResourceAttributes / LogAttributes) are NOT reliably translated to bracket access. Operators (>=, >, <=, <), wildcards (*), AND simple equality all hit translator gaps depending on the column. Symptoms: tile saves fine; clickstack_query_tile returns an error or returns zero rows when there should be matches; the dashboard renders "Error loading chart" on the tile. Do NOT trust dotted-path Lucene; use SQL with bracket access for ALL map-attribute filtering.

  Unreliable in Lucene (any operation, any operator):
    http.status_code:>=500    (operator)
    http.route:*              (wildcard -- also hits the substring matching trap above)
    db.system:mongodb         (simple equality; the translator does NOT map this to SpanAttributes['db.system'])

  Reliable in Lucene (top-level columns only):
    Duration:>1000000000      (top-level numeric range)
    ServiceName:checkout      (top-level string -- but remember this is a substring match, not exact!)

Workaround: switch to SQL with bracket access. Map values are stored as strings, so quote the comparison value.

  whereLanguage: "sql"
  where: "SpanAttributes['http.status_code'] >= '500'"

  whereLanguage: "sql"
  where: "SpanAttributes['db.system'] = 'mongodb'"

  whereLanguage: "sql"
  where: "SpanAttributes['http.route'] != ''"     (filters out empty keys; map values are often empty)

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
    $__filters                 dashboard filter conditions (1=1 when none).
                               REQUIRES sourceId on the tile. Set sourceId (unless the
                               query reads multiple tables) so dashboard filters apply.
    $__sourceTable             the source's \`database\`.\`table\`.
                               REQUIRES sourceId on the tile. Without it, the query fails to run.

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

NOTE: Authoring builder tiles on a metric source is not reliable today. The MCP select-item shape does not carry the metricName / metricType fields the metric query path needs, and a save with a metric sourceId may render in the UI as "Both table name and UUID are empty" even though the save itself succeeded. For metrics, use a raw SQL tile (configType: "sql") with explicit table reference. The standard tables that back a metric source are otel_metrics_gauge, otel_metrics_sum, and otel_metrics_histogram; clickstack_list_sources returns the metric source's metricTables map so you know which table holds which metric kind. Discovery: metric source schemas today do NOT publish mapAttributeKeys for ResourceAttributes / Attributes the way log and trace sources do, so attribute keys must be discovered by sampling (SELECT DISTINCT mapKeys(Attributes) FROM ...).

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

Optional dashboard-level filter declarations. Each entry adds a dropdown to the dashboard header that scopes tiles against the filter's expression. Use this for focused per-dimension dashboards (per-service, per-tenant, per-endpoint) instead of hardcoding the dimension into every tile's where clause.

Filter shape:
  { type, name, expression, sourceId, where?, whereLanguage?, appliesToSourceIds? }

  type                 "QUERY_EXPRESSION" (the only currently supported type).
  name                 Human label shown in the filter dropdown (e.g. "Service").
  expression           Column or attribute path the filter scopes (e.g. "ServiceName" or "SpanAttributes['tenant.id']").
  sourceId             Which source the dropdown VALUES are queried from. Independent of which tiles get filtered (see appliesToSourceIds below).
  where                Optional pre-filter that narrows the set of distinct values offered in the dropdown.
  whereLanguage        "lucene" or "sql". Defaults to "lucene".
  appliesToSourceIds   Optional list of source IDs the filter applies to. Omit (or pass undefined) to apply the filter to EVERY tile regardless of source (the recommended default). Pass a non-empty array to restrict the filter to tiles whose source is in that list, useful on mixed-source dashboards where the column only exists on some sources.

Example (broadcast to every tile, the common case):
  filters: [
    { type: "QUERY_EXPRESSION", name: "Service", expression: "ServiceName", sourceId: "<trace-source-id>" }
  ]

Example (scoped to the trace source only on a mixed log/trace/metric dashboard):
  filters: [
    {
      type: "QUERY_EXPRESSION",
      name: "Service",
      expression: "SpanName",
      sourceId: "<trace-source-id>",
      appliesToSourceIds: ["<trace-source-id>"]
    }
  ]

When a value is picked in the dropdown, the renderer combines it with each in-scope tile's existing where clause via AND. Tiles do NOT need to reference the filter name; matching the scope (or no scope set) is enough.

== TABLE TILE LINKING (config.onClick) ==

Table tiles can wire up row-click navigation via config.onClick. Builder table tiles (displayType: "table") and raw-SQL tiles (configType: "sql", displayType: "table") both accept this; other tile types ignore it.

Destination types:
  { type: "search",    target, whereLanguage, whereTemplate?, filters? }
    Opens the /search page for a log or trace source. Metric and session sources are rejected by the server (the /search page does not render those kinds).
  { type: "dashboard", target, whereLanguage, whereTemplate?, filters? }
    Opens another ClickStack dashboard owned by the same team.

Target shape, how the destination is identified:
  target: { mode: "id", id: "<object-id>" }
    Pins a specific source (for type=search) or dashboard (for type=dashboard) by its ID. Prefer this when the target is known. Find source IDs with clickstack_list_sources; find dashboard IDs with clickstack_get_dashboard (no id arg returns the list of all dashboards).
  target: { mode: "template", template: "<handlebars>" }
    Renders the template against the clicked row's columns, then resolves the result by NAME on the destination team. Example template "{{Service}}" reads the row's Service value and looks up a source/dashboard with that name. Use this when the destination depends on which row was clicked. A constant template like "Service Detail" (no Handlebars vars) simply resolves to the dashboard or source with that exact name.

Templating values come from the clicked row's columns. The column name in {{...}} must match a column produced by the table query (group-by columns and aliases both work).

  whereTemplate    Handlebars-style template. The rendered string is placed in the destination's \`where\` query param. Uses Lucene or SQL syntax matching \`whereLanguage\`. Example: "ServiceName = '{{service.name}}'".

  filters          Array of { kind: "expressionTemplate", expression, template }. Each filter renders to an IN clause on the destination (\`expression IN ('rendered-value')\`). When multiple filters share an expression they are merged into one IN clause. The destination dashboard auto-populates its filter list (matched by expression), so prefer this shape over whereTemplate when the target dashboard already declares the same filter expressions. If the destination dashboard does not declare a top-level filter whose \`expression\` matches, that value is dropped at click time and the destination opens unfiltered for that expression.

whereLanguage is optional, but set it to "sql" or "lucene" so the destination knows how to parse whereTemplate / filter values when a template is rendered.

Example, search drill-down with a row-driven filter:
  {
    "displayType": "table",
    "sourceId": "<trace-source-id>",
    "groupBy": "ResourceAttributes['service.name']",
    "select": [{ "aggFn": "count" }],
    "onClick": {
      "type": "search",
      "target": { "mode": "id", "id": "<trace-source-id>" },
      "whereLanguage": "sql",
      "filters": [
        {
          "kind": "expressionTemplate",
          "expression": "ServiceName",
          "template": "{{ResourceAttributes['service.name']}}"
        }
      ]
    }
  }

Example, dashboard drill-down with multiple row-driven filters:
  "onClick": {
    "type": "dashboard",
    "target": { "mode": "id", "id": "<service-detail-dashboard-id>" },
    "whereLanguage": "sql",
    "filters": [
      {
        "kind": "expressionTemplate",
        "expression": "ServiceName",
        "template": "{{ResourceAttributes['service.name']}}"
      },
      {
        "kind": "expressionTemplate",
        "expression": "Environment",
        "template": "{{ResourceAttributes['deployment.environment']}}"
      }
    ]
  }

Example, destination chosen by the clicked row (rare; prefer mode="id"):
  "onClick": {
    "type": "dashboard",
    "target": { "mode": "template", "template": "{{TargetDashboardName}}" },
    "whereLanguage": "lucene"
  }

Validation rules the server enforces:
  - target.id (mode="id") must be a valid ObjectId.
  - For type="search", target.id must reference an existing source whose kind is "log" or "trace". Metric and session sources are rejected with: "The following onClick search source IDs are not log or trace sources: ..."
  - For type="dashboard", target.id must reference an existing dashboard owned by the same team. Missing dashboards are rejected with: "Could not find the following onClick dashboard IDs: ..."

When pairing a service-inventory table with a service-detail dashboard, use target.mode: "template" with the partner dashboard's exact name as the constant template (e.g. "Service Detail"). The clicked row's groupBy column (ServiceName) carries through as a filter expression. See the "service_inventory" example in dashboard_examples for the canonical wiring.

== GROUPBY ALIASES AND ROW-CLICK TEMPLATES ==

Builder table tiles do NOT currently expose a groupBy alias / "AS" field. When the groupBy expression is a plain column (ServiceName, SpanName, StatusCode, SeverityText), the result column comes back with that same name, so {{ServiceName}} in an onClick template just works.

When the groupBy expression is a map attribute (SpanAttributes['http.route'], ResourceAttributes['deployment.environment']), the result column name is the raw expression (arrayElement(SpanAttributes, 'http.route') or similar), which is not a valid Handlebars identifier and cannot be referenced as {{Route}} or {{http.route}}.

Workaround: when you need a row-click drill-down from a map-attribute groupBy, author the tile as raw SQL (configType: "sql", displayType: "table") with an explicit AS alias on the groupBy column. Reference that alias from the onClick template.

  Builder, breaks {{Route}}:
    groupBy: "SpanAttributes['http.route']"   -- column comes back without a clean name

  Raw SQL, alias the column:
    configType: "sql", displayType: "table",
    sourceId: "<trace-source-id>",
    sqlTemplate: "SELECT SpanAttributes['http.route'] AS Route, count() AS Requests FROM otel_traces WHERE $__timeFilter(TimestampTime) AND $__filters GROUP BY Route ORDER BY Requests DESC LIMIT 100"
    onClick: { type: "search", target: { mode: "id", id: "<trace-source-id>" },
               whereLanguage: "sql",
               filters: [{ kind: "expressionTemplate", expression: "SpanAttributes['http.route']", template: "{{Route}}" }] }

For onClick drill-down on a plain top-level column (ServiceName), no workaround needed; use the builder.

== CONTAINERS AND TABS ==

Optional dashboard organization layer. Group related tiles visually with optional tab bars. Pass on clickstack_save_dashboard as a top-level "containers" array; reference containers from tiles via "containerId" (and "tabId" when the container has tabs).

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
  clickstack_save_dashboard({
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

Use clickstack_event_patterns when asked to find common log messages, recurring
patterns, noisy services, or top event types. This is the right choice whenever
the question is about "most common logs", "top patterns", "what is generating
the most log volume", or similar pattern-discovery questions.

It samples random events and clusters them with the Drain algorithm, returning:
  - pattern templates (with <*> wildcards for variable parts)
  - estimated counts (scaled from the sample to the full time range)
  - time-bucketed trends
  - a whereSnippet for each pattern to drill into matching raw events

Required parameters:
  - sourceId (call clickstack_list_sources first)
  - startTime / endTime for the time window

Optional parameters:
  - where: filter to specific services or severity levels before mining
  - sampleSize: increase for more accurate patterns (default 10000, max 25000)
  - bodyExpression: column to mine (auto-detected: Body for logs, SpanName for traces)

Example: find top patterns for production services over the last 4 hours:
  clickstack_event_patterns({
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
   NOTE: JSON-type columns DO use dot notation. Check jsType from clickstack_describe_source.

4. Multiple select items on number / pie / heatmap tiles
   Wrong:   displayType: "number", select: [{ aggFn: "count" }, { aggFn: "avg", ... }]
   Correct: displayType: "number", select: [{ aggFn: "count" }]
   Note: clickstack_table (the query tool) auto-upgrades shape:"number" to "table" when select has >1 item; dashboard tiles do not.

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
   The dashboard filter applies globally; tiles do not need the literal. On mixed-source dashboards where only some tiles carry the column, add appliesToSourceIds: ["<id>", ...] to scope the filter to just those sources instead of breaking the unrelated tiles.

8. Forgetting to validate tiles after saving
   Always call clickstack_query_tile on EVERY tile after clickstack_save_dashboard, not just one. Save validates input shape but not query semantics. Several known gaps (Lucene comparison/wildcard on map attributes, builder tiles on metric sources, malformed having) pass save and fail at render time. A dashboard with one bad tile renders the whole page in a degraded state; the user sees "Error loading chart" with no way to know which tile broke unless you validated. If query_tile returns an error, fix the where / SQL and re-save before declaring the dashboard ready.

9. Using connectionId with builder tiles, or omitting connectionId or sourceId on a single-table SQL tile
   Builder tiles (line, table, etc.) use sourceId (no connectionId).
   SQL tiles (configType: "sql") REQUIRE connectionId, and should ALSO set sourceId
   whenever the query reads a single table. SourceId is what makes $__filters work.
   Only omit sourceId on a SQL tile when the query spans multiple tables (e.g. JOINs).

10. Assuming StatusCode or SeverityText values
    Values like STATUS_CODE_ERROR, Ok, error, fatal vary by deployment.
    Always call clickstack_describe_source and inspect the lowCardinalityValues
    before writing filters that depend on these columns.

11. Heatmap tile on a non-Trace source
    Wrong:   { displayType: "heatmap", sourceId: "<log-source-id>", select: [...] }
    Correct: { displayType: "heatmap", sourceId: "<trace-source-id>", select: [...] }
    Heatmap is currently restricted to Trace sources. Pick a source whose kind is "trace" from clickstack_list_sources.

12. Heatmap tile with empty or missing valueExpression
    Wrong:   select: [{}]
    Wrong:   select: [{ valueExpression: "" }]
    Correct: select: [{ valueExpression: "Duration" }]
    Heatmap requires a non-empty numeric column or expression to bucket.

13. Missing alias on a select item
    Wrong:   select: [{ aggFn: "quantile", level: 0.95, valueExpression: "Duration" }]
    Correct: select: [{ aggFn: "quantile", level: 0.95, valueExpression: "Duration", alias: "P95" }]
    Every select entry MUST carry an alias. This applies to number tiles too, not just tables. Without alias the result column is named after the raw expression, which breaks orderBy references, breaks onClick template lookups, and shows ugly headers on tables. Number tiles render the value with the tile name in the UI, so the missing alias is invisible there, but the underlying query still emits a raw-expression column name. Treat "no alias" as a save-time bug, not a style nit.

14. Lucene on a map-attribute path (any operation)
    Wrong:   where: "http.status_code:>=500"      (operator)
    Wrong:   where: "http.route:*"                (wildcard)
    Wrong:   where: "db.system:mongodb"           (equality; translator does NOT map to SpanAttributes['db.system'])
    Correct: where: "SpanAttributes['http.status_code'] >= '500'"   (whereLanguage: "sql")
    Correct: where: "SpanAttributes['db.system'] = 'mongodb'"        (whereLanguage: "sql")
    Lucene parses dotted-path queries happily at save time but the translator does not reliably map them to bracket access. Behavior varies by column and operator. Treat any Lucene filter on a map-attribute key as a save-time bug and use SQL with bracket access for ALL map-attribute filtering. Map values are stored as strings; quote the comparison value.

15. Lucene field:value and field:value* (substring matching, not exact or true prefix)
    Wrong:   where: "SpanKind:Server"             (whereLanguage: "lucene"; translates to ilike(SpanKind, '%Server%') and matches "ServerStreaming", "InternalServer", etc.)
    Wrong:   where: "ServiceName:api*"            (whereLanguage: "lucene"; NOT a true prefix match -- it is prefix-within-substring)
    Correct: where: "SpanKind = 'Server'"          (whereLanguage: "sql"; exact match)
    Correct: where: "ServiceName LIKE 'api%'"      (whereLanguage: "sql"; true prefix match)
    Lucene field:value is a substring match (ilike with surrounding wildcards), not exact equality. Lucene field:value* is prefix-within-substring, not SQL LIKE 'value%'. Fine for free-text columns (Body, StatusMessage); wrong for enum-like columns where exact match matters (SpanKind, SeverityText, StatusCode) and wrong when true prefix matching is needed. Use SQL for exact match (=), prefix (LIKE 'x%'), contains (LIKE '%x%'), or regex (match(col, 'pattern')).

16. Forgetting that map-attribute values are often empty strings
    Wrong:   groupBy on SpanAttributes['db.collection.name'] without filtering empty values; the result has an empty-string bucket alongside the real ones, which renders as a blank row in tables and an unlabelled slice in pies.
    Correct: add where: "SpanAttributes['db.collection.name'] != ''" alongside the groupBy.
    ClickHouse map columns return '' (not NULL) for keys that were not set on a given row. Filter them out whenever you groupBy a map-attribute key that is not guaranteed populated on every event.

17. onClick on a non-table tile
    Only table tiles (builder displayType: "table" and raw-SQL configType: "sql"
    with displayType: "table") support config.onClick. Other displayTypes
    ignore the field. Putting onClick on a line/number/pie/heatmap/search/markdown
    tile won't error but won't do anything either.

18. onClick targeting a non-log/trace source for type="search"
    The /search page only renders log and trace sources. Targeting a
    metric or session source is rejected at save time with:
    "The following onClick search source IDs are not log or trace sources: ..."

19. Missing whereLanguage on onClick
    whereLanguage is technically optional, but should still be set to
    "lucene" or "sql" so the destination knows how to parse rendered
    whereTemplate / filter values. Leaving it unset can cause the
    destination to fall back to its own default.

20. Templating against a column that isn't in the table's select/groupBy
    Templates like "{{ServiceName}}" pull from the clicked row's columns.
    If the column doesn't appear in the table query, the template renders
    as empty at click time and the destination opens unfiltered. Match
    {{column}} names to columns produced by the table (group-by columns
    and aliases both work). For map-attribute groupBys, see GROUPBY ALIASES
    AND ROW-CLICK TEMPLATES; builder tiles do not alias map-attribute
    columns cleanly, so you need a raw SQL tile with explicit AS.

== REFERENCES ==

External docs for the syntax and macros referenced in this guide:

  Lucene search syntax (the "where" field with whereLanguage: "lucene"):
    https://clickhouse.com/docs/use-cases/observability/clickstack/search

  ClickHouse SQL functions (the "where" field with whereLanguage: "sql", and any sqlTemplate body):
    https://clickhouse.com/docs/sql-reference

  Dashboard time / filter macros used in raw-SQL tile sqlTemplate ($__timeFilter, $__timeFilter_ms, $__timeInterval, $__timeInterval_ms, $__filters, $__sourceTable):
    https://clickhouse.com/docs/use-cases/observability/clickstack/dashboards/sql-visualizations`;
}
