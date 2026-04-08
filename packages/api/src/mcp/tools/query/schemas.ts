import { z } from 'zod';

// ─── Shared schemas ──────────────────────────────────────────────────────────

export const mcpAggFnSchema = z
  .enum([
    'avg',
    'count',
    'count_distinct',
    'last_value',
    'max',
    'min',
    'quantile',
    'sum',
    'none',
  ])
  .describe(
    'Aggregation function:\n' +
      '  count – count matching rows (no valueExpression needed)\n' +
      '  sum / avg / min / max – aggregate a numeric column (valueExpression required)\n' +
      '  count_distinct – unique value count (valueExpression required)\n' +
      '  quantile – percentile; also set level (valueExpression required)\n' +
      '  last_value – most recent value of a column\n' +
      '  none – pass a raw expression through unchanged',
  );

export const mcpSelectItemSchema = z.object({
  aggFn: mcpAggFnSchema,
  valueExpression: z
    .string()
    .optional()
    .describe(
      'Column or expression to aggregate. Required for every aggFn except "count". ' +
        'Use PascalCase for top-level columns (e.g. "Duration", "StatusCode"). ' +
        "For span attributes use: SpanAttributes['key'] (e.g. SpanAttributes['http.method']). " +
        "For resource attributes use: ResourceAttributes['key'] (e.g. ResourceAttributes['service.name']).",
    ),
  where: z
    .string()
    .optional()
    .default('')
    .describe(
      'Row filter in Lucene syntax. ' +
        'Examples: "level:error", "service.name:api AND http.status_code:>=500"',
    ),
  whereLanguage: z
    .enum(['lucene', 'sql'])
    .optional()
    .default('lucene')
    .describe('Query language for the where filter. Default: lucene'),
  alias: z
    .string()
    .optional()
    .describe('Display label for this series. Example: "Error rate"'),
  level: z
    .union([z.literal(0.5), z.literal(0.9), z.literal(0.95), z.literal(0.99)])
    .optional()
    .describe(
      'Percentile level. Only applicable when aggFn is "quantile". ' +
        'Allowed values: 0.5, 0.9, 0.95, 0.99',
    ),
});

export const mcpTimeRangeSchema = z.object({
  startTime: z
    .string()
    .optional()
    .describe(
      'Start of the query window as ISO 8601. Default: 15 minutes ago. ' +
        'If results are empty, try a wider range (e.g. 24 hours).',
    ),
  endTime: z
    .string()
    .optional()
    .describe('End of the query window as ISO 8601. Default: now.'),
});

// ─── Discriminated union schema for hyperdx_query ───────────────────────────

export const builderQuerySchema = mcpTimeRangeSchema.extend({
  displayType: z
    .enum(['line', 'stacked_bar', 'table', 'number', 'pie'])
    .describe(
      'How to visualize the query results:\n' +
        '  line – time-series line chart\n' +
        '  stacked_bar – time-series stacked bar chart\n' +
        '  table – grouped aggregation as rows\n' +
        '  number – single aggregate scalar\n' +
        '  pie – pie chart (one metric, grouped)',
    ),
  sourceId: z
    .string()
    .describe(
      'Source ID. Call hyperdx_list_sources to find available sources.',
    ),
  select: z
    .array(mcpSelectItemSchema)
    .min(1)
    .max(10)
    .describe(
      'Metrics to compute. Each item defines an aggregation. ' +
        'For "number" display, provide exactly 1 item. ' +
        'Example: [{ aggFn: "count" }, { aggFn: "avg", valueExpression: "Duration" }]',
    ),
  groupBy: z
    .string()
    .optional()
    .describe(
      'Column to group/split by. ' +
        'Top-level columns use PascalCase (e.g. "SpanName", "StatusCode"). ' +
        "Span attributes: SpanAttributes['key'] (e.g. SpanAttributes['http.method']). " +
        "Resource attributes: ResourceAttributes['key'] (e.g. ResourceAttributes['service.name']).",
    ),
  orderBy: z
    .string()
    .optional()
    .describe('Column to sort results by (table display only).'),
  granularity: z
    .string()
    .optional()
    .describe(
      'Time bucket size for time-series charts (line, stacked_bar). ' +
        'Format: "<number> <unit>" where unit is second, minute, hour, or day. ' +
        'Examples: "1 minute", "5 minute", "1 hour", "1 day". ' +
        'Omit to let HyperDX pick automatically based on the time range.',
    ),
});

export const searchQuerySchema = mcpTimeRangeSchema.extend({
  displayType: z
    .literal('search')
    .describe('Search and filter individual log/event rows'),
  sourceId: z
    .string()
    .describe(
      'Source ID. Call hyperdx_list_sources to find available sources.',
    ),
  where: z
    .string()
    .optional()
    .default('')
    .describe(
      'Row filter. Examples: "level:error", "service.name:api AND duration:>500"',
    ),
  whereLanguage: z
    .enum(['lucene', 'sql'])
    .optional()
    .default('lucene')
    .describe('Query language for the where filter. Default: lucene'),
  columns: z
    .string()
    .optional()
    .default('')
    .describe(
      'Comma-separated columns to include. Leave empty for defaults. ' +
        'Example: "body,service.name,duration"',
    ),
  maxResults: z
    .number()
    .min(1)
    .max(200)
    .optional()
    .default(50)
    .describe(
      'Maximum number of rows to return (1–200). Default: 50. ' +
        'Use smaller values to reduce response size.',
    ),
});

export const sqlQuerySchema = mcpTimeRangeSchema.extend({
  displayType: z
    .literal('sql')
    .describe(
      'ADVANCED: Execute raw SQL directly against ClickHouse. ' +
        'Only use this when the builder query types (line, stacked_bar, table, number, pie, search) ' +
        'cannot express the query you need — e.g. complex JOINs, sub-queries, CTEs, or ' +
        'querying tables not registered as sources. ' +
        'Prefer the builder display types for standard queries as they are safer and easier to use.',
    ),
  connectionId: z
    .string()
    .describe(
      'Connection ID (not sourceId). Call hyperdx_list_sources to find available connections.',
    ),
  sql: z
    .string()
    .describe(
      'Raw ClickHouse SQL query to execute. ' +
        'Always include a LIMIT clause to avoid returning excessive data.\n\n' +
        'QUERY PARAMETERS (ClickHouse native parameterized syntax):\n' +
        '  {startDateMilliseconds:Int64} — start of date range in ms since epoch\n' +
        '  {endDateMilliseconds:Int64} — end of date range in ms since epoch\n' +
        '  {intervalSeconds:Int64} — time bucket size in seconds (time-series only)\n' +
        '  {intervalMilliseconds:Int64} — time bucket size in milliseconds (time-series only)\n\n' +
        'MACROS (expanded before execution):\n' +
        '  $__timeFilter(column) — expands to: column >= <start> AND column <= <end> (DateTime precision)\n' +
        '  $__timeFilter_ms(column) — same but with DateTime64 millisecond precision\n' +
        '  $__dateFilter(column) — same but with Date precision\n' +
        '  $__dateTimeFilter(dateCol, timeCol) — filters on both a Date and DateTime column\n' +
        '  $__dt(dateCol, timeCol) — alias for $__dateTimeFilter\n' +
        '  $__fromTime / $__toTime — start/end as DateTime values\n' +
        '  $__fromTime_ms / $__toTime_ms — start/end as DateTime64 values\n' +
        '  $__timeInterval(column) — time bucket expression: toStartOfInterval(toDateTime(column), INTERVAL ...)\n' +
        '  $__timeInterval_ms(column) — same with millisecond precision\n' +
        '  $__interval_s — raw interval in seconds\n' +
        '  $__filters — placeholder for dashboard filter conditions (resolves to 1=1 when no filters)\n\n' +
        'Example (time-series): "SELECT $__timeInterval(TimestampTime) AS ts, ServiceName, count() ' +
        'FROM otel_logs WHERE $__timeFilter(TimestampTime) GROUP BY ServiceName, ts ORDER BY ts"\n\n' +
        'Example (table): "SELECT ServiceName, count() AS n FROM otel_logs ' +
        'WHERE TimestampTime >= fromUnixTimestamp64Milli({startDateMilliseconds:Int64}) ' +
        'AND TimestampTime < fromUnixTimestamp64Milli({endDateMilliseconds:Int64}) ' +
        'GROUP BY ServiceName ORDER BY n DESC LIMIT 20"',
    ),
});

export const hyperdxQuerySchema = z.discriminatedUnion('displayType', [
  builderQuerySchema,
  searchQuerySchema,
  sqlQuerySchema,
]);
