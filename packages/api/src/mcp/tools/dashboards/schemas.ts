import { z } from 'zod/v4';

// ─── Shared tile schemas for MCP dashboard tools ─────────────────────────────

export const mcpTileSelectItemSchema = z.object({
  aggFn: z
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
      'Aggregation function. "count" requires no valueExpression; all others do.',
    ),
  valueExpression: z
    .string()
    .optional()
    .describe(
      'Column or expression to aggregate. Required for all aggFn except "count". ' +
        'Use PascalCase for top-level columns (e.g. "Duration", "StatusCode"). ' +
        "For span attributes use: SpanAttributes['key'] (e.g. SpanAttributes['http.method']). " +
        "For resource attributes use: ResourceAttributes['key'] (e.g. ResourceAttributes['service.name']).",
    ),
  where: z
    .string()
    .optional()
    .default('')
    .describe('Filter in Lucene syntax. Example: "level:error"'),
  whereLanguage: z.enum(['lucene', 'sql']).optional().default('lucene'),
  alias: z.string().optional().describe('Display label for this series'),
  level: z
    .union([z.literal(0.5), z.literal(0.9), z.literal(0.95), z.literal(0.99)])
    .optional()
    .describe('Percentile level for aggFn="quantile"'),
});

export const mcpTileLayoutSchema = z.object({
  name: z.string().describe('Tile title shown on the dashboard'),
  x: z
    .number()
    .min(0)
    .max(23)
    .optional()
    .default(0)
    .describe('Horizontal grid position (0–23). Default 0'),
  y: z
    .number()
    .min(0)
    .optional()
    .default(0)
    .describe('Vertical grid position. Default 0'),
  w: z
    .number()
    .min(1)
    .max(24)
    .optional()
    .default(12)
    .describe('Width in grid columns (1–24). Default 12'),
  h: z
    .number()
    .min(1)
    .optional()
    .default(4)
    .describe('Height in grid rows. Default 4'),
  id: z
    .string()
    .max(36)
    .optional()
    .describe('Tile ID (auto-generated if omitted)'),
});

export const mcpLineTileSchema = mcpTileLayoutSchema.extend({
  config: z.object({
    displayType: z.literal('line').describe('Line chart over time'),
    sourceId: z.string().describe('Source ID – call hyperdx_list_sources'),
    select: z
      .array(mcpTileSelectItemSchema)
      .min(1)
      .max(20)
      .describe('Metrics to plot (one series per item)'),
    groupBy: z
      .string()
      .optional()
      .describe(
        'Column to split/group by. ' +
          'Top-level columns use PascalCase (e.g. "SpanName", "StatusCode"). ' +
          "Span attributes: SpanAttributes['key'] (e.g. SpanAttributes['http.method']). " +
          "Resource attributes: ResourceAttributes['key'] (e.g. ResourceAttributes['service.name']).",
      ),
    fillNulls: z.boolean().optional().default(true),
    alignDateRangeToGranularity: z.boolean().optional(),
    asRatio: z
      .boolean()
      .optional()
      .describe(
        'Plot as ratio of two metrics (requires exactly 2 select items)',
      ),
  }),
});

export const mcpBarTileSchema = mcpTileLayoutSchema.extend({
  config: z.object({
    displayType: z
      .literal('stacked_bar')
      .describe('Stacked bar chart over time'),
    sourceId: z.string().describe('Source ID – call hyperdx_list_sources'),
    select: z.array(mcpTileSelectItemSchema).min(1).max(20),
    groupBy: z.string().optional(),
    fillNulls: z.boolean().optional().default(true),
    alignDateRangeToGranularity: z.boolean().optional(),
    asRatio: z.boolean().optional(),
  }),
});

export const mcpTableTileSchema = mcpTileLayoutSchema.extend({
  config: z.object({
    displayType: z.literal('table').describe('Tabular aggregated data'),
    sourceId: z.string().describe('Source ID – call hyperdx_list_sources'),
    select: z.array(mcpTileSelectItemSchema).min(1).max(20),
    groupBy: z
      .string()
      .optional()
      .describe(
        'Group rows by this column. Use PascalCase for top-level columns (e.g. "SpanName"). ' +
          "For attributes: SpanAttributes['key'] or ResourceAttributes['key'].",
      ),
    orderBy: z.string().optional().describe('Sort results by this column'),
    asRatio: z.boolean().optional(),
  }),
});

export const mcpNumberFormatSchema = z
  .object({
    output: z
      .enum(['currency', 'percent', 'byte', 'time', 'number'])
      .describe(
        'Format category. "time" auto-formats durations (use factor for input unit). ' +
          '"byte" formats as KB/MB/GB. "currency" prepends a symbol. "percent" appends %.',
      ),
    mantissa: z
      .number()
      .int()
      .optional()
      .describe('Decimal places (0–10). Not used for "time" output.'),
    thousandSeparated: z
      .boolean()
      .optional()
      .describe('Separate thousands (e.g. 1,234,567)'),
    average: z
      .boolean()
      .optional()
      .describe('Abbreviate large numbers (e.g. 1.2m)'),
    decimalBytes: z
      .boolean()
      .optional()
      .describe(
        'Use decimal base for bytes (1KB = 1000). Only for "byte" output.',
      ),
    factor: z
      .number()
      .optional()
      .describe(
        'Input unit factor for "time" output. ' +
          '1 = seconds, 0.001 = milliseconds, 0.000001 = microseconds, 0.000000001 = nanoseconds.',
      ),
    currencySymbol: z
      .string()
      .optional()
      .describe('Currency symbol (e.g. "$"). Only for "currency" output.'),
    unit: z
      .string()
      .optional()
      .describe('Suffix appended to the value (e.g. " req/s")'),
  })
  .describe(
    'Controls how the number value is formatted for display. ' +
      'Most useful: { output: "time", factor: 0.000000001 } to auto-format nanosecond durations, ' +
      'or { output: "number", mantissa: 2, thousandSeparated: true } for clean counts.',
  );

export const mcpNumberTileSchema = mcpTileLayoutSchema.extend({
  config: z.object({
    displayType: z.literal('number').describe('Single aggregate scalar value'),
    sourceId: z.string().describe('Source ID – call hyperdx_list_sources'),
    select: z
      .array(mcpTileSelectItemSchema)
      .length(1)
      .describe('Exactly one metric to display'),
    numberFormat: mcpNumberFormatSchema
      .optional()
      .describe(
        'Display formatting for the number value. Example: { output: "time", factor: 0.000000001 } ' +
          'to auto-format nanosecond durations as human-readable time.',
      ),
  }),
});

export const mcpPieTileSchema = mcpTileLayoutSchema.extend({
  config: z.object({
    displayType: z.literal('pie').describe('Pie chart'),
    sourceId: z.string().describe('Source ID – call hyperdx_list_sources'),
    select: z.array(mcpTileSelectItemSchema).length(1),
    groupBy: z
      .string()
      .optional()
      .describe(
        'Column that defines pie slices. Use PascalCase for top-level columns. ' +
          "For attributes: SpanAttributes['key'] or ResourceAttributes['key'].",
      ),
  }),
});

export const mcpSearchTileSchema = mcpTileLayoutSchema.extend({
  config: z.object({
    displayType: z.literal('search').describe('Log/event search results list'),
    sourceId: z.string().describe('Source ID – call hyperdx_list_sources'),
    where: z
      .string()
      .optional()
      .default('')
      .describe('Filter in Lucene syntax. Example: "level:error"'),
    whereLanguage: z.enum(['lucene', 'sql']).optional().default('lucene'),
    select: z
      .string()
      .optional()
      .default('')
      .describe(
        'Columns to display (empty = defaults). Example: "body,service.name,duration"',
      ),
  }),
});

export const mcpMarkdownTileSchema = mcpTileLayoutSchema.extend({
  config: z.object({
    displayType: z.literal('markdown').describe('Free-form Markdown text tile'),
    markdown: z.string().optional().default(''),
  }),
});

export const mcpSqlTileSchema = mcpTileLayoutSchema.extend({
  config: z.object({
    configType: z
      .literal('sql')
      .describe(
        'Must be "sql" for raw SQL tiles. ' +
          'ADVANCED: Only use raw SQL tiles when the builder tile types cannot express the query you need.',
      ),
    displayType: z
      .enum(['line', 'stacked_bar', 'table', 'number', 'pie'])
      .describe('How to render the SQL results'),
    connectionId: z
      .string()
      .describe(
        'Connection ID (not sourceId) – call hyperdx_list_sources to find available connections',
      ),
    sqlTemplate: z
      .string()
      .describe(
        'Raw ClickHouse SQL query. Always include a LIMIT clause to avoid excessive data.\n' +
          'Use query parameters: {startDateMilliseconds:Int64}, {endDateMilliseconds:Int64}, ' +
          '{intervalSeconds:Int64}, {intervalMilliseconds:Int64}.\n' +
          'Or use macros: $__timeFilter(col), $__timeFilter_ms(col), $__dateFilter(col), ' +
          '$__fromTime, $__toTime, $__fromTime_ms, $__toTime_ms, ' +
          '$__timeInterval(col), $__timeInterval_ms(col), $__interval_s, $__filters.\n' +
          'Example: "SELECT $__timeInterval(TimestampTime) AS ts, ServiceName, count() ' +
          'FROM otel_logs WHERE $__timeFilter(TimestampTime) AND $__filters ' +
          'GROUP BY ServiceName, ts ORDER BY ts"',
      ),
    fillNulls: z.boolean().optional(),
    alignDateRangeToGranularity: z.boolean().optional(),
  }),
});

export const mcpTileSchema = z.union([
  mcpLineTileSchema,
  mcpBarTileSchema,
  mcpTableTileSchema,
  mcpNumberTileSchema,
  mcpPieTileSchema,
  mcpSearchTileSchema,
  mcpMarkdownTileSchema,
  mcpSqlTileSchema,
]);

export const mcpTilesParam = z
  .array(mcpTileSchema)
  .describe(
    'Array of dashboard tiles. Each tile needs a name, optional layout (x/y/w/h), and a config block. ' +
      'The config block varies by displayType – use hyperdx_list_sources for sourceId and connectionId values.\n\n' +
      'Example tiles:\n' +
      '1. Line chart: { "name": "Error Rate", "config": { "displayType": "line", "sourceId": "<from list_sources>", ' +
      '"groupBy": "ResourceAttributes[\'service.name\']", "select": [{ "aggFn": "count", "where": "StatusCode:STATUS_CODE_ERROR" }] } }\n' +
      '2. Table: { "name": "Top Endpoints", "config": { "displayType": "table", "sourceId": "<from list_sources>", ' +
      '"groupBy": "SpanAttributes[\'http.route\']", "select": [{ "aggFn": "count" }, { "aggFn": "avg", "valueExpression": "Duration" }] } }\n' +
      '3. Number: { "name": "Total Requests", "config": { "displayType": "number", "sourceId": "<from list_sources>", ' +
      '"select": [{ "aggFn": "count" }], "numberFormat": { "output": "number", "average": true } } }\n' +
      '4. Number (duration): { "name": "P95 Latency", "config": { "displayType": "number", "sourceId": "<from list_sources>", ' +
      '"select": [{ "aggFn": "quantile", "level": 0.95, "valueExpression": "Duration" }], ' +
      '"numberFormat": { "output": "time", "factor": 0.000000001 } } }',
  );
