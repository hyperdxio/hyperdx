// ─── Prompt content builders ──────────────────────────────────────────────────
// Each function returns a plain string that is injected as a prompt message.
//
// prose-lint: allow-file
// This file is an LLM-facing prompt template that uses em-dash separators
// (e.g. "line — Time-series trends") as a structural bullet convention.
// Reformatting all separators is out of scope for this change.

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

1. Call hyperdx_list_sources — get source IDs, column schemas, and attribute keys
2. Design tiles — pick tile types that match the monitoring goal
3. Call hyperdx_save_dashboard — create the dashboard with all tiles
4. Call hyperdx_query_tile on each tile — validate queries return data

== TILE TYPE GUIDE ==

Use BUILDER tiles (with sourceId) for most cases:
  line        — Time-series trends (error rate, request volume, latency over time)
  stacked_bar — Compare categories over time (requests by service, errors by status code)
  number      — Single KPI metric (total requests, current error rate, p99 latency)
  table       — Ranked lists (top endpoints by latency, error counts by service).
                Tables can wire row-click navigation via config.onClick to the
                /search page or another dashboard — see "ROW-CLICK LINKING" below.
  pie         — Proportional breakdowns (traffic share by service, errors by type)
  heatmap     — Distribution of a numeric value over time (latency buckets, request size buckets)
                Trace sources only. Requires non-empty valueExpression.
  search      — Browse raw log/event rows (error logs, recent traces)
  markdown    — Dashboard notes, section headers, or documentation

Use RAW SQL tiles (with connectionId) only for advanced queries:
  Requires configType: "sql" plus a displayType (line, stacked_bar, table, number, pie)
  Use when you need JOINs, sub-queries, CTEs, or queries the builder cannot express

== COLUMN NAMING ==

- Top-level columns use PascalCase by default: Duration, StatusCode, SpanName, Body, SeverityText, ServiceName
  NOTE: These are defaults for the standard HyperDX schema. Custom sources may use different names.
  Always call hyperdx_list_sources to get the real column names and keyColumns for each source.
- Map-type columns use bracket syntax: SpanAttributes['http.method'], ResourceAttributes['service.name']
  NEVER use dot notation for Map columns (SpanAttributes.http.method) — always use brackets.
- JSON-type columns use dot notation: JsonColumn.key.subkey
  Check the jsType returned by hyperdx_list_sources to determine whether a column is Map or JSON.
- Call hyperdx_list_sources to discover the exact column names, types, and attribute keys

== LAYOUT GRID ==

The dashboard grid is 24 columns wide. Tiles are positioned with (x, y, w, h):
  - Number tiles: w=6, h=4 — fit 4 across in a row
  - Line/Bar charts: w=12, h=4 — fit 2 side-by-side
  - Tables: w=24, h=6 — full width
  - Search tiles: w=24, h=6 — full width
  - Markdown: w=24, h=2 — full width section header

Recommended layout pattern (top to bottom):
  Row 0: KPI number tiles across the top (y=0)
  Row 1: Time-series charts (y=4)
  Row 2: Tables or search tiles (y=8)

== FILTER SYNTAX (Lucene) ==

Simple match:       level:error
AND:                service.name:api AND http.status_code:>=500
OR:                 level:error OR level:fatal
Wildcards:          service.name:front*
Negation:           NOT level:debug
Exists:             _exists_:http.route
Range:              Duration:>1000000000
Phrase:             Body:"connection refused"
Grouped:            (level:error OR level:fatal) AND service.name:api

== COMPLETE EXAMPLE ==

Here is a full dashboard creation call with properly structured tiles:

hyperdx_save_dashboard({
  name: "Service Overview",
  tags: ["overview"],
  tiles: [
    {
      name: "Total Requests",
      x: 0, y: 0, w: 6, h: 4,
      config: {
        displayType: "number",
        sourceId: "${traceSourceId}",
        select: [{ aggFn: "count" }]
      }
    },
    {
      name: "Error Count",
      x: 6, y: 0, w: 6, h: 4,
      config: {
        displayType: "number",
        sourceId: "${traceSourceId}",
        select: [{ aggFn: "count", where: "StatusCode:STATUS_CODE_ERROR" }]
      }
    },
    {
      name: "P95 Latency (ms)",
      x: 12, y: 0, w: 6, h: 4,
      config: {
        displayType: "number",
        sourceId: "${traceSourceId}",
        select: [{ aggFn: "quantile", valueExpression: "Duration", level: 0.95 }]
      }
    },
    {
      name: "Request Rate by Service",
      x: 0, y: 4, w: 12, h: 4,
      config: {
        displayType: "line",
        sourceId: "${traceSourceId}",
        select: [{ aggFn: "count" }],
        groupBy: "ResourceAttributes['service.name']"
      }
    },
    {
      name: "Error Rate Over Time",
      x: 12, y: 4, w: 12, h: 4,
      config: {
        displayType: "line",
        sourceId: "${traceSourceId}",
        select: [
          { aggFn: "count", where: "StatusCode:STATUS_CODE_ERROR", alias: "Errors" },
          { aggFn: "count", alias: "Total" }
        ],
        asRatio: true
      }
    },
    {
      name: "Top Endpoints by Request Count",
      x: 0, y: 8, w: 24, h: 6,
      config: {
        displayType: "table",
        sourceId: "${traceSourceId}",
        groupBy: "SpanName",
        select: [
          { aggFn: "count", alias: "Requests" },
          { aggFn: "avg", valueExpression: "Duration", alias: "Avg Duration" },
          { aggFn: "quantile", valueExpression: "Duration", level: 0.95, alias: "P95 Duration" }
        ]
      }
    }
  ]
})

== ROW-CLICK LINKING (table tiles) ==

Table tiles support an optional config.onClick that turns each row into a
drill-down link to the /search page or another dashboard. Use this when
the dashboard answers "which thing?" and the user needs the next step —
"what's actually happening in that thing?" — to be one click away.

Two destination types:
  type: "search"    — opens /search for a log or trace source. Source
                      kind must be "log" or "trace"; metric/session
                      sources are rejected.
  type: "dashboard" — opens another HyperDX dashboard.

Two ways to address the destination:
  target.mode: "id"       — pin a concrete source/dashboard by its ID.
                            Prefer this when the target is known up-front;
                            it survives renames.
  target.mode: "template" — render a Handlebars-style template against the
                            clicked row, then resolve by NAME on the
                            destination team. Example template "Service Details: {{ServiceName}}"
                            reads the row's ServiceName column and looks up a
                            source/dashboard with that name.

Templating, applied at click time:
  whereTemplate   — raw filter expression placed in the destination's
                    \`where\` query param. Uses Lucene or SQL syntax matching
                    \`whereLanguage\`. Example: "ServiceName = '{{service.name}}'".
  filters         — array of { kind: "expressionTemplate", expression,
                    template }. Each becomes an IN clause on the destination
                    (\`expression IN ('rendered-value')\`); filters that share
                    an expression are merged into one IN clause. Prefer
                    filters over whereTemplate for simple row-driven
                    equality — the destination dashboard auto-populates its
                    own dropdown filters from these values.

Field rules:
  - onClick is supported on builder table tiles AND raw-SQL tiles with
    displayType: "table". Other displayTypes ignore the field.
  - whereLanguage is optional but should be set to "sql" or "lucene" to match
    the content of the whereTemplate, when one is set.
  - Template values are pulled from the clicked row's columns. The column
    name in {{...}} must match a column produced by the table query.
  - Filters for dashboard targets should be used when the expression is
    already defined as a filter on the target dashboard, otherwise it will
    not be applied.

Example — drill from a per-service error count into the matching trace
search, scoping the search to that service:
  {
    "name": "Errors by Service",
    "config": {
      "displayType": "table",
      "sourceId": "<trace-source-id>",
      "groupBy": "ResourceAttributes['service.name']",
      "select": [
        { "aggFn": "count", "where": "StatusCode:STATUS_CODE_ERROR" }
      ],
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
  }

Example — drill from a service overview row into a per-service dashboard:
  "onClick": {
    "type": "dashboard",
    "target": { "mode": "id", "id": "<service-detail-dashboard-id>" },
    "whereLanguage": "sql",
    "filters": [
      {
        "kind": "expressionTemplate",
        "expression": "ServiceName",
        "template": "{{ResourceAttributes['service.name']}}"
      }
    ]
  }

== STATUS CODE & SEVERITY VALUES ==

IMPORTANT: The exact values for StatusCode and SeverityText vary by deployment.
Do NOT assume values like "STATUS_CODE_ERROR", "Ok", "error", or "fatal".
Always call hyperdx_list_sources first and inspect the keyValues / mapAttributeKeys
returned for each source to discover the real values used in your data.

== COMMON MISTAKES TO AVOID ==

- Using valueExpression with aggFn "count" — count does not take a valueExpression
- Forgetting valueExpression for non-count aggFns — avg, sum, min, max, quantile all require it
- Using dot notation for Map-type attributes — always use SpanAttributes['key'] bracket syntax for Map columns
- Not calling hyperdx_list_sources first — you need real source IDs, not placeholders
- Not validating with hyperdx_query_tile after saving — tiles can silently fail
- Number and Pie tiles accept exactly 1 select item — not multiple
- Missing level for quantile aggFn — must specify 0.5, 0.9, 0.95, or 0.99
- Assuming StatusCode or SeverityText values — always inspect the source first
- Heatmap tile on a non-Trace source — heatmap is restricted to Trace sources today
- Heatmap tile with empty valueExpression — required, e.g. "Duration"`;
}

export function buildDashboardExamplesPrompt(
  traceSourceId: string,
  logSourceId: string,
  connectionId: string,
  pattern?: string,
): string {
  const examples: Record<string, string> = {};

  examples['service_overview'] = `
== SERVICE HEALTH OVERVIEW ==

A high-level view of service health with KPIs, trends, and endpoint details.

{
  name: "Service Health Overview",
  tags: ["overview", "service"],
  tiles: [
    {
      name: "Total Requests",
      x: 0, y: 0, w: 6, h: 4,
      config: {
        displayType: "number",
        sourceId: "${traceSourceId}",
        select: [{ aggFn: "count" }]
      }
    },
    {
      name: "Error Count",
      x: 6, y: 0, w: 6, h: 4,
      config: {
        displayType: "number",
        sourceId: "${traceSourceId}",
        select: [{ aggFn: "count", where: "StatusCode:STATUS_CODE_ERROR" }]
      }
    },
    {
      name: "Avg Latency",
      x: 12, y: 0, w: 6, h: 4,
      config: {
        displayType: "number",
        sourceId: "${traceSourceId}",
        select: [{ aggFn: "avg", valueExpression: "Duration" }]
      }
    },
    {
      name: "P99 Latency",
      x: 18, y: 0, w: 6, h: 4,
      config: {
        displayType: "number",
        sourceId: "${traceSourceId}",
        select: [{ aggFn: "quantile", valueExpression: "Duration", level: 0.99 }]
      }
    },
    {
      name: "Request Volume Over Time",
      x: 0, y: 4, w: 12, h: 4,
      config: {
        displayType: "line",
        sourceId: "${traceSourceId}",
        select: [{ aggFn: "count" }],
        groupBy: "ResourceAttributes['service.name']"
      }
    },
    {
      name: "Error Rate Over Time",
      x: 12, y: 4, w: 12, h: 4,
      config: {
        displayType: "line",
        sourceId: "${traceSourceId}",
        select: [
          { aggFn: "count", where: "StatusCode:STATUS_CODE_ERROR", alias: "Errors" },
          { aggFn: "count", alias: "Total" }
        ],
        asRatio: true
      }
    },
    {
      name: "Top Endpoints",
      x: 0, y: 8, w: 24, h: 6,
      config: {
        displayType: "table",
        sourceId: "${traceSourceId}",
        groupBy: "SpanName",
        select: [
          { aggFn: "count", alias: "Requests" },
          { aggFn: "avg", valueExpression: "Duration", alias: "Avg Duration" },
          { aggFn: "quantile", valueExpression: "Duration", level: 0.95, alias: "P95" },
          { aggFn: "count", where: "StatusCode:STATUS_CODE_ERROR", alias: "Errors" }
        ]
      }
    }
  ]
}`;

  examples['error_tracking'] = `
== ERROR TRACKING ==

Focus on errors: volume, distribution, and raw error logs.

{
  name: "Error Tracking",
  tags: ["errors"],
  tiles: [
    {
      name: "Total Errors",
      x: 0, y: 0, w: 8, h: 4,
      config: {
        displayType: "number",
        sourceId: "${logSourceId}",
        select: [{ aggFn: "count", where: "SeverityText:error OR SeverityText:fatal" }]
      }
    },
    {
      name: "Errors Over Time by Service",
      x: 0, y: 4, w: 12, h: 4,
      config: {
        displayType: "line",
        sourceId: "${logSourceId}",
        select: [{ aggFn: "count", where: "SeverityText:error OR SeverityText:fatal" }],
        groupBy: "ResourceAttributes['service.name']"
      }
    },
    {
      name: "Error Breakdown by Service",
      x: 12, y: 4, w: 12, h: 4,
      config: {
        displayType: "pie",
        sourceId: "${logSourceId}",
        select: [{ aggFn: "count", where: "SeverityText:error OR SeverityText:fatal" }],
        groupBy: "ResourceAttributes['service.name']"
      }
    },
    {
      name: "Error Logs",
      x: 0, y: 8, w: 24, h: 6,
      config: {
        displayType: "search",
        sourceId: "${logSourceId}",
        where: "SeverityText:error OR SeverityText:fatal"
      }
    }
  ]
}`;

  examples['latency'] = `
== LATENCY MONITORING ==

Track response times with percentile breakdowns and slow endpoint identification.

{
  name: "Latency Monitoring",
  tags: ["latency", "performance"],
  tiles: [
    {
      name: "P50 Latency",
      x: 0, y: 0, w: 6, h: 4,
      config: {
        displayType: "number",
        sourceId: "${traceSourceId}",
        select: [{ aggFn: "quantile", valueExpression: "Duration", level: 0.5 }]
      }
    },
    {
      name: "P95 Latency",
      x: 6, y: 0, w: 6, h: 4,
      config: {
        displayType: "number",
        sourceId: "${traceSourceId}",
        select: [{ aggFn: "quantile", valueExpression: "Duration", level: 0.95 }]
      }
    },
    {
      name: "P99 Latency",
      x: 12, y: 0, w: 6, h: 4,
      config: {
        displayType: "number",
        sourceId: "${traceSourceId}",
        select: [{ aggFn: "quantile", valueExpression: "Duration", level: 0.99 }]
      }
    },
    {
      name: "Latency Percentiles Over Time",
      x: 0, y: 4, w: 24, h: 4,
      config: {
        displayType: "line",
        sourceId: "${traceSourceId}",
        select: [
          { aggFn: "quantile", valueExpression: "Duration", level: 0.5, alias: "P50" },
          { aggFn: "quantile", valueExpression: "Duration", level: 0.95, alias: "P95" },
          { aggFn: "quantile", valueExpression: "Duration", level: 0.99, alias: "P99" }
        ]
      }
    },
    {
      name: "Latency by Service",
      x: 0, y: 8, w: 12, h: 4,
      config: {
        displayType: "stacked_bar",
        sourceId: "${traceSourceId}",
        select: [{ aggFn: "avg", valueExpression: "Duration" }],
        groupBy: "ResourceAttributes['service.name']"
      }
    },
    {
      name: "Slowest Endpoints",
      x: 12, y: 8, w: 12, h: 6,
      config: {
        displayType: "table",
        sourceId: "${traceSourceId}",
        groupBy: "SpanName",
        select: [
          { aggFn: "quantile", valueExpression: "Duration", level: 0.95, alias: "P95 Duration" },
          { aggFn: "avg", valueExpression: "Duration", alias: "Avg Duration" },
          { aggFn: "count", alias: "Request Count" }
        ]
      }
    }
  ]
}`;

  examples['log_analysis'] = `
== LOG ANALYSIS ==

Analyze log volume, severity distribution, and browse log events.

{
  name: "Log Analysis",
  tags: ["logs"],
  tiles: [
    {
      name: "Total Log Events",
      x: 0, y: 0, w: 8, h: 4,
      config: {
        displayType: "number",
        sourceId: "${logSourceId}",
        select: [{ aggFn: "count" }]
      }
    },
    {
      name: "Log Volume by Severity",
      x: 0, y: 4, w: 12, h: 4,
      config: {
        displayType: "stacked_bar",
        sourceId: "${logSourceId}",
        select: [{ aggFn: "count" }],
        groupBy: "SeverityText"
      }
    },
    {
      name: "Severity Breakdown",
      x: 12, y: 4, w: 12, h: 4,
      config: {
        displayType: "pie",
        sourceId: "${logSourceId}",
        select: [{ aggFn: "count" }],
        groupBy: "SeverityText"
      }
    },
    {
      name: "Top Services by Log Volume",
      x: 0, y: 8, w: 12, h: 6,
      config: {
        displayType: "table",
        sourceId: "${logSourceId}",
        groupBy: "ResourceAttributes['service.name']",
        select: [
          { aggFn: "count", alias: "Log Count" },
          { aggFn: "count", where: "SeverityText:error OR SeverityText:fatal", alias: "Error Count" }
        ]
      }
    },
    {
      name: "Recent Logs",
      x: 12, y: 8, w: 12, h: 6,
      config: {
        displayType: "search",
        sourceId: "${logSourceId}"
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
== INFRASTRUCTURE MONITORING (Raw SQL) ==

Advanced dashboard using raw SQL tiles for custom ClickHouse queries.
Use this pattern when you need JOINs, CTEs, or queries the builder cannot express.

{
  name: "Infrastructure (SQL)",
  tags: ["infrastructure", "sql"],
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
    $__timeFilter(col)        — col >= <start> AND col <= <end> (DateTime)
    $__timeFilter_ms(col)     — same with DateTime64 millisecond precision
    $__dateFilter(col)        — same with Date precision
    $__timeInterval(col)      — time bucket: toStartOfInterval(toDateTime(col), INTERVAL ...)
    $__timeInterval_ms(col)   — same with millisecond precision
    $__fromTime / $__toTime   — start/end as DateTime values
    $__fromTime_ms / $__toTime_ms — start/end as DateTime64 values
    $__interval_s             — raw interval in seconds
    $__filters                — dashboard filter conditions (resolves to 1=1 when none)

  Query parameters:
    {startDateMilliseconds:Int64} — start of date range in milliseconds
    {endDateMilliseconds:Int64}   — end of date range in milliseconds
    {intervalSeconds:Int64}       — time bucket size in seconds
    {intervalMilliseconds:Int64}  — time bucket size in milliseconds

  Available parameters by displayType:
    line / stacked_bar — startDate, endDate, interval (all available)
    table / number / pie — startDate, endDate only (no interval)`;

  if (pattern) {
    const key = pattern.toLowerCase().replace(/[\s-]+/g, '_');
    const matched = Object.entries(examples).find(([k]) => k === key);
    if (matched) {
      return `Dashboard example for pattern: ${pattern}\n\nReplace sourceId/connectionId values with real IDs from hyperdx_list_sources.\nNOTE: Column names below (Duration, StatusCode, SpanName, etc.) are defaults for the standard schema. Call hyperdx_list_sources to get the actual column names for your sources.\n${matched[1]}`;
    }
    return (
      `No example found for pattern "${pattern}". Available patterns: ${Object.keys(examples).join(', ')}\n\n` +
      `Showing all examples below.\n\n` +
      Object.values(examples).join('\n')
    );
  }

  return (
    `Complete dashboard examples for common observability patterns.\n` +
    `Replace sourceId/connectionId values with real IDs from hyperdx_list_sources.\n` +
    `NOTE: Column names below (Duration, StatusCode, SpanName, etc.) are defaults for the standard schema. Call hyperdx_list_sources to get the actual column names for your sources.\n\n` +
    `Available patterns: ${Object.keys(examples).join(', ')}\n` +
    Object.values(examples).join('\n')
  );
}

export function buildQueryGuidePrompt(): string {
  return `Reference guide for writing queries with HyperDX MCP tools (hyperdx_query and hyperdx_save_dashboard).

== AGGREGATION FUNCTIONS (aggFn) ==

  count          — Count matching rows. Does NOT take a valueExpression.
  sum            — Sum of a numeric column. Requires valueExpression.
  avg            — Average of a numeric column. Requires valueExpression.
  min            — Minimum value. Requires valueExpression.
  max            — Maximum value. Requires valueExpression.
  count_distinct — Count of unique values. Requires valueExpression.
  quantile       — Percentile value. Requires valueExpression AND level (0.5, 0.9, 0.95, or 0.99).
  last_value     — Most recent value of a column. Requires valueExpression.
  none           — Pass a raw expression unchanged. Requires valueExpression.
  heatmap        — Heatmap-only literal. Requires non-empty valueExpression.
                   Used exclusively in heatmap tiles' select array.

Examples:
  { aggFn: "count" }
  { aggFn: "avg", valueExpression: "Duration" }
  { aggFn: "quantile", valueExpression: "Duration", level: 0.95 }
  { aggFn: "count_distinct", valueExpression: "ResourceAttributes['service.name']" }
  { aggFn: "sum", valueExpression: "Duration", where: "StatusCode:STATUS_CODE_ERROR" }
  { valueExpression: "Duration" }  // heatmap tile only (no aggFn; chart-level displayType is the discriminator)

== COLUMN NAMING ==

Top-level columns (PascalCase defaults — use directly in valueExpression and groupBy):
  Duration, StatusCode, SpanName, ServiceName, Body, SeverityText,
  Timestamp, TraceId, SpanId, SpanKind, ParentSpanId
  NOTE: These are the defaults for the standard HyperDX schema. Custom sources may
  use different column names. Always verify with hyperdx_list_sources, which returns
  the real column names and keyColumns expressions for each source.

Map-type columns (bracket syntax — access keys via ['key']):
  SpanAttributes['http.method']
  SpanAttributes['http.route']
  SpanAttributes['http.status_code']
  ResourceAttributes['service.name']
  ResourceAttributes['deployment.environment']

IMPORTANT: Always use bracket syntax for Map-type columns. Never use dot notation for Maps.
  Correct:   SpanAttributes['http.method']
  Incorrect: SpanAttributes.http.method

JSON-type columns (dot notation — access nested keys via dot path):
  JsonColumn.key.subkey
  NOTE: Check the jsType field returned by hyperdx_list_sources to determine
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
This is different from valueExpression/groupBy which requires bracket syntax (SpanAttributes['http.method']).

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
    $__timeFilter(col)         — col >= <start> AND col <= <end>
    $__timeFilter_ms(col)      — same with DateTime64 millisecond precision
    $__dateFilter(col)         — same with Date precision
    $__dateTimeFilter(d, t)    — filters on both Date and DateTime columns
    $__timeInterval(col)       — time bucket expression for GROUP BY
    $__timeInterval_ms(col)    — same with millisecond precision
    $__fromTime / $__toTime    — start/end as DateTime values
    $__fromTime_ms / $__toTime_ms — start/end as DateTime64 values
    $__interval_s              — raw interval in seconds (for arithmetic)
    $__filters                 — dashboard filter conditions (1=1 when none)

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

  IMPORTANT: Always include a LIMIT clause in table/number/pie SQL queries.

== PER-TILE TYPE CONSTRAINTS ==

  number  — Exactly 1 select item. No groupBy.
  pie     — Exactly 1 select item. groupBy defines the slices.
  line    — 1-20 select items. Optional groupBy splits into series.
  stacked_bar — 1-20 select items. Optional groupBy splits into stacks.
  table   — 1-20 select items. Optional groupBy defines row groups.
  heatmap — Exactly 1 select item with a non-empty valueExpression. No
            aggFn or alias on the select item (the chart-level
            displayType: "heatmap" is the discriminator). Trace sources
            only (no Log/Metric/Session). No groupBy. Optional where
            filter applied before bucketing.
  search  — No select items (select is a column list string). where is the filter.
  markdown — No select items. Set markdown field with content.

== asRatio ==

Set asRatio: true on line/stacked_bar/table tiles with exactly 2 select items
to plot the first as a ratio of the second. Useful for error rates:
  select: [
    { aggFn: "count", where: "StatusCode:STATUS_CODE_ERROR", alias: "Errors" },
    { aggFn: "count", alias: "Total" }
  ],
  asRatio: true

== TABLE TILE LINKING (config.onClick) ==

Table tiles can wire up row-click navigation via config.onClick. Builder
table tiles (displayType: "table") and raw-SQL tiles (configType: "sql",
displayType: "table") both accept this; other tile types ignore it.

Destination types:
  { type: "search",    target, whereLanguage, whereTemplate?, filters? }
    Opens the /search page for a log or trace source. Metric and session
    sources are rejected by the server (the /search page does not render
    those kinds).
  { type: "dashboard", target, whereLanguage, whereTemplate?, filters? }
    Opens another HyperDX dashboard owned by the same team.

Target shape — how the destination is identified:
  target: { mode: "id", id: "<object-id>" }
    Pins a specific source (for type=search) or dashboard
    (for type=dashboard) by its ID. Prefer this when the target is known.
    Find source IDs with hyperdx_list_sources; find dashboard IDs with
    hyperdx_get_dashboard (no id arg returns the list of all dashboards).
  target: { mode: "template", template: "<handlebars>" }
    Renders the template against the clicked row's columns, then resolves
    the result by NAME on the destination team. Example template
    "{{Service}}" reads the row's Service value and looks up a
    source/dashboard with that name. Use this when the destination depends
    on which row was clicked.

Templating values come from the clicked row's columns. The column name in
{{...}} must match a column produced by the table query (group-by columns
and aliases both work).

  whereTemplate — Handlebars-style template. The rendered string is placed
                  in the destination's \`where\` query param. Uses Lucene or
                  SQL syntax matching \`whereLanguage\`. Example:
                  "ServiceName = '{{service.name}}'".

  filters       — array of { kind: "expressionTemplate", expression,
                  template }. Each filter renders to an IN clause on the
                  destination (\`expression IN ('rendered-value')\`). When
                  multiple filters share an expression they are merged
                  into one IN clause. The destination dashboard
                  auto-populates its filter list (matched by expression),
                  so prefer this shape over whereTemplate when the target
                  dashboard already declares the same filter expressions.

whereLanguage is optional, but set it to "sql" or "lucene" so the
destination knows how to parse whereTemplate / filter values when a
template is rendered.

Example — search drill-down with a row-driven filter:
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

Example — dashboard drill-down with multiple row-driven filters:
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

Example — destination chosen by the clicked row (rare; prefer mode="id"):
  "onClick": {
    "type": "dashboard",
    "target": { "mode": "template", "template": "{{TargetDashboardName}}" },
    "whereLanguage": "lucene"
  }

Validation categories the server enforces:
  - target.id (mode="id") must be a valid ObjectId.
  - For type="search", target.id must reference an existing source whose
    kind is "log" or "trace" — metric/session sources are rejected with:
    "The following onClick search source IDs are not log or trace sources: ..."
  - For type="dashboard", target.id must reference an existing dashboard
    owned by the same team; missing dashboards are rejected with:
    "Could not find the following onClick dashboard IDs: ..."

== CONTAINERS AND TABS ==

Optional dashboard organization layer. Group related tiles visually with
optional tab bars. Pass on hyperdx_save_dashboard as a top-level "containers"
array; reference containers from tiles via "containerId" (and "tabId" when
the container has tabs).

Container shape:
  { id, title, collapsed, collapsible?, bordered?, tabs? }

  id, title    : required, non-empty strings.
  collapsed    : required boolean. Starts collapsed when true.
  collapsible  : optional boolean. Defaults to true. When false the group
                 header has no toggle.
  bordered     : optional boolean. Defaults to true.
  tabs         : optional array of { id, title }. Zero or one tab renders
                 as a plain group header; two or more render as a tab bar.

Tile fields (on the same tile shape used in tiles[]):
  containerId  : optional. Must match an id in containers[].
  tabId        : optional. Must match a tab id on that container. Requires
                 containerId. A tile with containerId set but no tabId
                 renders in the container shell (above any tab bar).

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
          { id: "errors", title: "Errors" },
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

Validation categories on bad inputs:
  - tile.containerId references a missing container id
  - tile.tabId references a missing tab id on that container
  - tile.tabId set without tile.containerId
  - duplicate container.id within the dashboard
  - duplicate tab.id within a single container

The server returns a descriptive error string identifying the failing path
(tiles[i].containerId, tiles[i].tabId, containers[i].id, or
containers[i].tabs[j].id). Read the path to know which input to fix.

== COMMON MISTAKES ==

1. Using valueExpression with aggFn "count"
   Wrong:   { aggFn: "count", valueExpression: "Duration" }
   Correct: { aggFn: "count" }

2. Forgetting valueExpression for non-count aggFns
   Wrong:   { aggFn: "avg" }
   Correct: { aggFn: "avg", valueExpression: "Duration" }

3. Using dot notation for Map-type attributes in valueExpression/groupBy
   Wrong:   groupBy: "SpanAttributes.http.method"
   Correct: groupBy: "SpanAttributes['http.method']"
   NOTE: JSON-type columns DO use dot notation. Check jsType from hyperdx_list_sources.

4. Multiple select items on number/pie tiles
   Wrong:   displayType: "number", select: [{ aggFn: "count" }, { aggFn: "avg", ... }]
   Correct: displayType: "number", select: [{ aggFn: "count" }]

5. Missing level for quantile
   Wrong:   { aggFn: "quantile", valueExpression: "Duration" }
   Correct: { aggFn: "quantile", valueExpression: "Duration", level: 0.95 }

6. Forgetting to validate tiles after saving
   Always call hyperdx_query_tile after hyperdx_save_dashboard to verify each tile returns data.

7. Using sourceId with SQL tiles or connectionId with builder tiles
   Builder tiles (line, table, etc.) use sourceId.
   SQL tiles (configType: "sql") use connectionId.

8. Assuming StatusCode or SeverityText values
   Values like STATUS_CODE_ERROR, Ok, error, fatal vary by deployment.
   Always call hyperdx_list_sources and inspect real keyValues from the source
   before writing filters that depend on these columns.

9. Heatmap tile on a non-Trace source
   Wrong:   { displayType: "heatmap", sourceId: "<log-source-id>", select: [...] }
   Correct: { displayType: "heatmap", sourceId: "<trace-source-id>", select: [...] }
   Heatmap is currently restricted to Trace sources. Pick a source whose kind
   is "trace" from hyperdx_list_sources.

10. Heatmap tile with empty or missing valueExpression
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
    and aliases both work).`;
}
