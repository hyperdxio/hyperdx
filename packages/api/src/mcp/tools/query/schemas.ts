import { z } from 'zod';

// ─── Shared schemas ──────────────────────────────────────────────────────────

const mcpAggFnSchema = z
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

const mcpSelectItemSchema = z.object({
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

// ─── Display type groups (used for validation) ──────────────────────────────

const BUILDER_DISPLAY_TYPES = [
  'line',
  'stacked_bar',
  'table',
  'number',
  'pie',
] as const;

type BuilderDisplayType = (typeof BUILDER_DISPLAY_TYPES)[number];

function isBuilderDisplayType(dt: string): dt is BuilderDisplayType {
  return (BUILDER_DISPLAY_TYPES as readonly string[]).includes(dt);
}

// ─── Flat object schema for hyperdx_query ───────────────────────────────────
// Uses a single z.object() instead of z.discriminatedUnion() so the MCP SDK
// can serialize it to JSON Schema correctly. The SDK's normalizeObjectSchema()
// only recognizes z.object() schemas — discriminated unions and ZodEffects
// (from .superRefine/.refine/.transform) are silently replaced with an empty
// schema in the tools/list response.
//
// To work around this, the schema is split into two parts:
//   1. hyperdxQuerySchema — plain z.object() used as inputSchema for the SDK
//   2. validateQueryInput — cross-field validation applied at runtime

export const hyperdxQuerySchema = z.object({
  // ── Shared fields (all display types) ──
  displayType: z
    .enum(['line', 'stacked_bar', 'table', 'number', 'pie', 'search', 'sql'])
    .describe(
      'How to query and visualize the data:\n' +
        '  line – time-series line chart (builder)\n' +
        '  stacked_bar – time-series stacked bar chart (builder)\n' +
        '  table – grouped aggregation as rows (builder)\n' +
        '  number – single aggregate scalar (builder)\n' +
        '  pie – pie chart, one metric grouped (builder)\n' +
        '  search – browse individual log/event rows\n' +
        '  sql – ADVANCED: raw ClickHouse SQL query',
    ),
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

  // ── Builder + search fields ──
  sourceId: z
    .string()
    .optional()
    .describe(
      'Source ID — required for builder display types (line, stacked_bar, table, number, pie) ' +
        'and for "search". Call hyperdx_list_sources to find available sources.',
    ),
  select: z
    .array(mcpSelectItemSchema)
    .min(1)
    .max(10)
    .optional()
    .describe(
      'Metrics to compute — required for builder display types (line, stacked_bar, table, number, pie). ' +
        'Each item defines an aggregation. ' +
        'For "number" display, provide exactly 1 item. ' +
        'Example: [{ aggFn: "count" }, { aggFn: "avg", valueExpression: "Duration" }]',
    ),
  groupBy: z
    .string()
    .optional()
    .describe(
      'Column to group/split by (builder display types only). ' +
        'Top-level columns use PascalCase (e.g. "SpanName", "StatusCode"). ' +
        "Span attributes: SpanAttributes['key'] (e.g. SpanAttributes['http.method']). " +
        "Resource attributes: ResourceAttributes['key'] (e.g. ResourceAttributes['service.name']).",
    ),
  orderBy: z
    .string()
    .optional()
    .describe(
      'Column to sort results by (builder display types only, mainly "table").',
    ),
  granularity: z
    .string()
    .optional()
    .describe(
      'Time bucket size for time-series charts (line, stacked_bar). ' +
        'Format: "<number> <unit>" where unit is second, minute, hour, or day. ' +
        'Examples: "1 minute", "5 minute", "1 hour", "1 day". ' +
        'Omit to let HyperDX pick automatically based on the time range.',
    ),

  // ── Search-only fields ──
  where: z
    .string()
    .optional()
    .default('')
    .describe(
      'Row filter for "search" display type. ' +
        'Examples: "level:error", "service.name:api AND duration:>500"',
    ),
  whereLanguage: z
    .enum(['lucene', 'sql'])
    .optional()
    .default('lucene')
    .describe(
      'Query language for the "where" filter ("search" display type only). Default: lucene',
    ),
  columns: z
    .string()
    .optional()
    .default('')
    .describe(
      'Comma-separated columns to include in search results ("search" display type only). ' +
        'Leave empty for defaults. Example: "body,service.name,duration"',
    ),
  maxResults: z
    .number()
    .min(1)
    .max(200)
    .optional()
    .default(50)
    .describe(
      'Maximum number of rows to return for "search" display type (1–200). Default: 50. ' +
        'Use smaller values to reduce response size.',
    ),

  // ── SQL-only fields ──
  connectionId: z
    .string()
    .optional()
    .describe(
      'Connection ID — required for "sql" display type (not sourceId). ' +
        'Call hyperdx_list_sources to find available connections.',
    ),
  sql: z
    .string()
    .optional()
    .describe(
      'Raw ClickHouse SQL query — required for "sql" display type. ' +
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

/**
 * Cross-field validation for the query schema. Applied at runtime in the
 * handler rather than via .superRefine() so the base z.object() stays intact
 * for the MCP SDK's schema serialization.
 *
 * Returns a user-facing error string if validation fails, or null if valid.
 */
export function validateQueryInput(
  data: z.infer<typeof hyperdxQuerySchema>,
): string | null {
  const { displayType } = data;

  if (isBuilderDisplayType(displayType)) {
    if (!data.sourceId) {
      return `sourceId is required when displayType is "${displayType}"`;
    }
    if (!data.select || data.select.length === 0) {
      return `select is required when displayType is "${displayType}"`;
    }
  } else if (displayType === 'search') {
    if (!data.sourceId) {
      return 'sourceId is required when displayType is "search"';
    }
  } else if (displayType === 'sql') {
    if (!data.connectionId) {
      return 'connectionId is required when displayType is "sql"';
    }
    if (!data.sql) {
      return 'sql is required when displayType is "sql"';
    }
  }

  return null;
}
