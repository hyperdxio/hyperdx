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
      '  count: count matching rows (no valueExpression needed)\n' +
      '  sum / avg / min / max: aggregate a numeric column (valueExpression required)\n' +
      '  count_distinct: unique value count (valueExpression required)\n' +
      '  quantile: percentile; also set level (valueExpression required)\n' +
      '  last_value: most recent value of a column\n' +
      '  none: pass a raw expression through unchanged',
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

const mcpTimeRangeSchema = z.object({
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

// ─── Flat schema for hyperdx_query ──────────────────────────────────────────
//
// IMPORTANT: this is a `ZodRawShape` (object literal of schemas), not a
// top-level `z.discriminatedUnion`. The MCP SDK's `registerTool()` only
// publishes a JSON Schema to the client when the input is a ZodRawShape;
// passing a discriminated union (or any other top-level Zod type) causes
// the client to receive `{type:"object",properties:{}}` and the LLM has no
// idea what shape to send. We branch by `displayType` at runtime instead.

const sqlMacrosDoc =
  'SQL displayType:\n' +
  '  ADVANCED: only use when the builder display types cannot express the query.\n' +
  '  Always include LIMIT.\n' +
  '  Parameters: {startDateMilliseconds:Int64}, {endDateMilliseconds:Int64},\n' +
  '              {intervalSeconds:Int64}, {intervalMilliseconds:Int64}.\n' +
  '  Macros: $__timeFilter(col), $__timeFilter_ms(col), $__dateFilter(col),\n' +
  '          $__dateTimeFilter(dateCol,timeCol), $__dt(dateCol,timeCol),\n' +
  '          $__fromTime, $__toTime, $__fromTime_ms, $__toTime_ms,\n' +
  '          $__timeInterval(col), $__timeInterval_ms(col), $__interval_s,\n' +
  '          $__filters.\n' +
  '  Example: SELECT $__timeInterval(TimestampTime) AS ts, ServiceName, count()\n' +
  '           FROM otel_logs WHERE $__timeFilter(TimestampTime)\n' +
  '           GROUP BY ServiceName, ts ORDER BY ts';

export const hyperdxQuerySchema = {
  displayType: z
    .enum(['line', 'stacked_bar', 'table', 'number', 'pie', 'search', 'sql'])
    .describe(
      'How to visualize the query results:\n' +
        '  line: time-series line chart (builder)\n' +
        '  stacked_bar: time-series stacked bar chart (builder)\n' +
        '  table: grouped aggregation as rows (builder)\n' +
        '  number: single aggregate scalar (builder)\n' +
        '  pie: pie chart, one metric grouped (builder)\n' +
        '  search: browse individual log/event rows (search)\n' +
        '  sql: execute raw ClickHouse SQL (advanced)',
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

  // ─── Builder + search fields ─────────────────────────────────────────────
  sourceId: z
    .string()
    .optional()
    .describe(
      'Source ID. Required for builder display types (line, stacked_bar, ' +
        'table, number, pie) and search. Call hyperdx_list_sources to find ' +
        'available sources.',
    ),
  select: z
    .array(mcpSelectItemSchema)
    .min(1)
    .max(10)
    .optional()
    .describe(
      'Metrics to compute. Required for builder display types. ' +
        'Each item defines an aggregation. For "number" display, provide exactly 1 item. ' +
        'Example: [{ aggFn: "count" }, { aggFn: "avg", valueExpression: "Duration" }]',
    ),
  groupBy: z
    .string()
    .optional()
    .describe(
      'Column to group/split by (builder only). ' +
        'Top-level columns use PascalCase (e.g. "SpanName", "StatusCode"). ' +
        "Span attributes: SpanAttributes['key']. Resource attributes: ResourceAttributes['key'].",
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

  // ─── search-only fields ──────────────────────────────────────────────────
  where: z
    .string()
    .optional()
    .describe(
      'Row filter (search only). Examples: "level:error", "service.name:api AND duration:>500"',
    ),
  whereLanguage: z
    .enum(['lucene', 'sql'])
    .optional()
    .describe(
      'Query language for the where filter (search only). Default: lucene',
    ),
  columns: z
    .string()
    .optional()
    .describe(
      'Comma-separated columns to include (search only). Leave empty for defaults. ' +
        'Example: "body,service.name,duration"',
    ),
  maxResults: z
    .number()
    .min(1)
    .max(200)
    .optional()
    .describe(
      'Maximum number of rows to return (search only, 1–200). Default: 50.',
    ),

  // ─── sql-only fields ─────────────────────────────────────────────────────
  connectionId: z
    .string()
    .optional()
    .describe(
      'Connection ID (not sourceId). Required for sql display type. ' +
        'Call hyperdx_list_sources to find available connections.',
    ),
  sql: z.string().optional().describe(sqlMacrosDoc),
};

// Runtime-validated input. Use after the SDK's per-field validation.
export type HyperdxQueryInput = {
  displayType:
    | 'line'
    | 'stacked_bar'
    | 'table'
    | 'number'
    | 'pie'
    | 'search'
    | 'sql';
  startTime?: string;
  endTime?: string;
  sourceId?: string;
  select?: Array<z.infer<typeof mcpSelectItemSchema>>;
  groupBy?: string;
  orderBy?: string;
  granularity?: string;
  where?: string;
  whereLanguage?: 'lucene' | 'sql';
  columns?: string;
  maxResults?: number;
  connectionId?: string;
  sql?: string;
};

/**
 * Validate the parts of the input that depend on `displayType`. The SDK has
 * already validated each field in isolation; this enforces cross-field
 * required-ness (e.g. builder needs sourceId+select, sql needs connectionId+sql).
 */
export function validateHyperdxQueryInput(
  input: HyperdxQueryInput,
): string | null {
  const isBuilder = ['line', 'stacked_bar', 'table', 'number', 'pie'].includes(
    input.displayType,
  );
  if (isBuilder) {
    if (!input.sourceId)
      return 'sourceId is required for builder display types';
    if (!input.select || input.select.length === 0) {
      return 'select must be a non-empty array for builder display types';
    }
    if (input.displayType === 'number' && input.select.length !== 1) {
      return 'select must contain exactly 1 item for displayType "number"';
    }
  } else if (input.displayType === 'search') {
    if (!input.sourceId) return 'sourceId is required for displayType "search"';
  } else if (input.displayType === 'sql') {
    if (!input.connectionId) {
      return 'connectionId is required for displayType "sql"';
    }
    if (!input.sql) return 'sql is required for displayType "sql"';
  }
  return null;
}
