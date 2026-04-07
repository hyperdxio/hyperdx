// ─── Prompt content builders ──────────────────────────────────────────────────
// Each function returns a plain string that is injected as a prompt message.

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
  table       — Ranked lists (top endpoints by latency, error counts by service)
  pie         — Proportional breakdowns (traffic share by service, errors by type)
  search      — Browse raw log/event rows (error logs, recent traces)
  markdown    — Dashboard notes, section headers, or documentation

Use RAW SQL tiles (with connectionId) only for advanced queries:
  Requires configType: "sql" plus a displayType (line, stacked_bar, table, number, pie)
  Use when you need JOINs, sub-queries, CTEs, or queries the builder cannot express

== COLUMN NAMING ==

- Top-level columns use PascalCase: Duration, StatusCode, SpanName, Body, SeverityText, ServiceName
- Map attributes use bracket syntax: SpanAttributes['http.method'], ResourceAttributes['service.name']
- NEVER use dot notation (SpanAttributes.http.method) — always use brackets
- Call hyperdx_list_sources to discover the exact column names and attribute keys

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

== COMMON MISTAKES TO AVOID ==

- Using valueExpression with aggFn "count" — count does not take a valueExpression
- Forgetting valueExpression for non-count aggFns — avg, sum, min, max, quantile all require it
- Using dot notation for map attributes — always use SpanAttributes['key'] bracket syntax
- Not calling hyperdx_list_sources first — you need real source IDs, not placeholders
- Not validating with hyperdx_query_tile after saving — tiles can silently fail
- Number and Pie tiles accept exactly 1 select item — not multiple
- Missing level for quantile aggFn — must specify 0.5, 0.9, 0.95, or 0.99`;
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
      return `Dashboard example for pattern: ${pattern}\n\nReplace sourceId/connectionId values with real IDs from hyperdx_list_sources.\n${matched[1]}`;
    }
    return (
      `No example found for pattern "${pattern}". Available patterns: ${Object.keys(examples).join(', ')}\n\n` +
      `Showing all examples below.\n\n` +
      Object.values(examples).join('\n')
    );
  }

  return (
    `Complete dashboard examples for common observability patterns.\n` +
    `Replace sourceId/connectionId values with real IDs from hyperdx_list_sources.\n\n` +
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

Examples:
  { aggFn: "count" }
  { aggFn: "avg", valueExpression: "Duration" }
  { aggFn: "quantile", valueExpression: "Duration", level: 0.95 }
  { aggFn: "count_distinct", valueExpression: "ResourceAttributes['service.name']" }
  { aggFn: "sum", valueExpression: "Duration", where: "StatusCode:STATUS_CODE_ERROR" }

== COLUMN NAMING ==

Top-level columns (PascalCase — use directly in valueExpression and groupBy):
  Duration, StatusCode, SpanName, ServiceName, Body, SeverityText,
  Timestamp, TraceId, SpanId, SpanKind, ParentSpanId

Map attribute columns (bracket syntax — access keys via ['key']):
  SpanAttributes['http.method']
  SpanAttributes['http.route']
  SpanAttributes['http.status_code']
  ResourceAttributes['service.name']
  ResourceAttributes['deployment.environment']

IMPORTANT: Always use bracket syntax for map columns. Never use dot notation.
  Correct:   SpanAttributes['http.method']
  Incorrect: SpanAttributes.http.method

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

== COMMON MISTAKES ==

1. Using valueExpression with aggFn "count"
   Wrong:   { aggFn: "count", valueExpression: "Duration" }
   Correct: { aggFn: "count" }

2. Forgetting valueExpression for non-count aggFns
   Wrong:   { aggFn: "avg" }
   Correct: { aggFn: "avg", valueExpression: "Duration" }

3. Using dot notation for map attributes in valueExpression/groupBy
   Wrong:   groupBy: "SpanAttributes.http.method"
   Correct: groupBy: "SpanAttributes['http.method']"

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
   SQL tiles (configType: "sql") use connectionId.`;
}
