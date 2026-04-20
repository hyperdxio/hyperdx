import {
  AggregateFunctionSchema,
  SearchConditionLanguageSchema,
} from '@hyperdx/common-utils/dist/types';
import { z } from 'zod';

import { externalQuantileLevelSchema } from '@/utils/zod';

// ─── Row-click (onClick) schemas for drill-down linking ──────────────────────
// Kept parallel to TableOnClickSchema in common-utils/types.ts so each field
// carries rich Zod `.describe()` annotations for the LLM.

const mcpOnClickFilterEntrySchema = z.object({
  filter: z
    .string()
    .describe(
      'SQL expression to filter on at the destination (usually a column name). ' +
        'Example: "ServiceName" or "SpanAttributes[\'http.route\']". ' +
        'Multiple entries with the same `filter` are merged into one `IN (...)` clause.',
    ),
  template: z
    .string()
    .describe(
      "Handlebars template rendered per-row for this filter's value. " +
        'Example: "{{ServiceName}}". Value is SQL-escaped automatically.',
    ),
});

const mcpOnClickSchema = z
  .discriminatedUnion('type', [
    z
      .object({ type: z.literal('none') })
      .describe('Default: row click opens search pre-filtered by group-by.'),
    z.object({
      type: z.literal('dashboard'),
      target: z.discriminatedUnion('mode', [
        z.object({
          mode: z.literal('id'),
          dashboardId: z
            .string()
            .describe(
              'Target dashboard ObjectId. Use this when the target is a ' +
                'specific, known dashboard (you usually have its id from a ' +
                'prior hyperdx_save_dashboard call in the same session).',
            ),
        }),
        z.object({
          mode: z.literal('name-template'),
          nameTemplate: z
            .string()
            .describe(
              'Handlebars template that must resolve to the exact name of ' +
                'a dashboard on the same team (case-insensitive). The rendered ' +
                'name must match EXACTLY ONE dashboard or the click surfaces ' +
                'a toast error. Example: "{{ServiceName}} Details".',
            ),
        }),
      ]),
      whereTemplate: z
        .string()
        .optional()
        .describe(
          'Optional Handlebars template rendered into the destination ' +
            "dashboard's global WHERE input. Example: \"ServiceName = '{{ServiceName}}'\". " +
            'Row values are NOT auto-escaped here — use filterValueTemplates ' +
            'for values coming from the row unless you need raw SQL.',
        ),
      whereLanguage: SearchConditionLanguageSchema.optional().describe(
        'Language of whereTemplate: "sql" or "lucene". Default "sql".',
      ),
      filterValueTemplates: z
        .array(mcpOnClickFilterEntrySchema)
        .optional()
        .describe(
          'Adds per-column filters to the destination URL as ' +
            '`expression IN (value)`. Values are SQL-escaped automatically.',
        ),
    }),
    z.object({
      type: z.literal('search'),
      source: z.discriminatedUnion('mode', [
        z.object({
          mode: z.literal('id'),
          sourceId: z
            .string()
            .describe('Target source id from hyperdx_list_sources.'),
        }),
        z.object({
          mode: z.literal('template'),
          sourceTemplate: z
            .string()
            .describe(
              'Handlebars template rendered to a source id or case-insensitive ' +
                'source name. Example: "{{SourceName}}".',
            ),
        }),
      ]),
      whereTemplate: z.string().optional(),
      whereLanguage: SearchConditionLanguageSchema.optional(),
      filterValueTemplates: z
        .array(mcpOnClickFilterEntrySchema)
        .optional()
        .describe(
          'Adds per-column filters on the destination search page as ' +
            '`expression IN (value)`.',
        ),
    }),
  ])
  .describe(
    'Row-click drill-down action. Only applies to table tiles. On click, the ' +
      "row's column values are threaded through Handlebars templates so the " +
      "destination reflects the clicked row. The current dashboard's time " +
      'range is always propagated.\n\n' +
      'Available Handlebars helpers:\n' +
      '  • {{int v}}              round a number / numeric string to an integer\n' +
      '  • {{default v "fb"}}     fallback when v is null/empty\n' +
      '  • {{#eq a b}}..{{/eq}}   block helper: renders body when a === b\n' +
      '  • {{json v}}             JSON.stringify(v)\n' +
      '  • {{encodeURIComponent v}}\n' +
      'Built-in Handlebars helpers (#if, #each, #with, lookup, etc.) are ' +
      'DISABLED for security — stick to the helpers above. Strict mode is on, ' +
      'so referencing a column the row does not have aborts navigation with a ' +
      'toast error.\n\n' +
      'Typical patterns:\n' +
      '1. Drill from a services table into a per-service dashboard:\n' +
      '   { "type": "dashboard", "target": { "mode": "name-template", ' +
      '"nameTemplate": "{{ServiceName}} Details" }, ' +
      '"filterValueTemplates": [{ "filter": "ServiceName", "template": "{{ServiceName}}" }] }\n' +
      '2. Drill into search for a specific error:\n' +
      '   { "type": "search", "source": { "mode": "id", "sourceId": "<log source>" }, ' +
      '"filterValueTemplates": [{ "filter": "TraceId", "template": "{{TraceId}}" }] }',
  );

// ─── Shared tile schemas for MCP dashboard tools ─────────────────────────────
const mcpTileSelectItemSchema = z
  .object({
    aggFn: AggregateFunctionSchema.describe(
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
    whereLanguage: SearchConditionLanguageSchema.optional().default('lucene'),
    alias: z.string().optional().describe('Display label for this series'),
    level: externalQuantileLevelSchema
      .optional()
      .describe('Percentile level for aggFn="quantile"'),
  })
  .superRefine((data, ctx) => {
    if (data.level && data.aggFn !== 'quantile') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Level can only be used with quantile aggregation function',
      });
    }
    if (data.valueExpression && data.aggFn === 'count') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          'Value expression cannot be used with count aggregation function',
      });
    } else if (!data.valueExpression && data.aggFn !== 'count') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          'Value expression is required for non-count aggregation functions',
      });
    }
  });

const mcpTileLayoutSchema = z.object({
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

const mcpLineTileSchema = mcpTileLayoutSchema.extend({
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

const mcpBarTileSchema = mcpTileLayoutSchema.extend({
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

const mcpTableTileSchema = mcpTileLayoutSchema.extend({
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
    onClick: mcpOnClickSchema
      .optional()
      .describe(
        'Optional row-click action. Use to build drill-down dashboards that ' +
          'navigate to another dashboard or the search page with the row ' +
          'values threaded through as filters. See the discriminated union ' +
          'above for the shape.',
      ),
  }),
});

const mcpNumberFormatSchema = z
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

const mcpNumberTileSchema = mcpTileLayoutSchema.extend({
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

const mcpPieTileSchema = mcpTileLayoutSchema.extend({
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

const mcpSearchTileSchema = mcpTileLayoutSchema.extend({
  config: z.object({
    displayType: z.literal('search').describe('Log/event search results list'),
    sourceId: z.string().describe('Source ID – call hyperdx_list_sources'),
    where: z
      .string()
      .optional()
      .default('')
      .describe('Filter in Lucene syntax. Example: "level:error"'),
    whereLanguage: SearchConditionLanguageSchema.optional().default('lucene'),
    select: z
      .string()
      .optional()
      .default('')
      .describe(
        'Columns to display (empty = defaults). Example: "body,service.name,duration"',
      ),
  }),
});

const mcpMarkdownTileSchema = mcpTileLayoutSchema.extend({
  config: z.object({
    displayType: z.literal('markdown').describe('Free-form Markdown text tile'),
    markdown: z.string().optional().default(''),
  }),
});

const mcpSqlTileSchema = mcpTileLayoutSchema.extend({
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
    onClick: mcpOnClickSchema
      .optional()
      .describe(
        'Optional row-click action. Only meaningful when displayType is ' +
          '"table". Rendered column keys in Handlebars templates come from ' +
          'the SQL query result (aliased column names / SELECT expressions).',
      ),
  }),
});

const mcpTileSchema = z.union([
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
      '"numberFormat": { "output": "time", "factor": 0.000000001 } } }\n' +
      '5. Linked table (drill into a per-service dashboard by name): ' +
      '{ "name": "Services", "config": { "displayType": "table", "sourceId": "<from list_sources>", ' +
      '"groupBy": "ResourceAttributes[\'service.name\']", "select": [{ "aggFn": "count" }], ' +
      '"onClick": { "type": "dashboard", "target": { "mode": "name-template", ' +
      '"nameTemplate": "{{`ResourceAttributes[\'service.name\']`}} Details" }, ' +
      '"filterValueTemplates": [{ "filter": "ResourceAttributes[\'service.name\']", ' +
      '"template": "{{`ResourceAttributes[\'service.name\']`}}" }] } } }\n' +
      '6. Linked table (drill into search by trace id): ' +
      '{ "name": "Recent Errors", "config": { "displayType": "table", "sourceId": "<log source>", ' +
      '"groupBy": "TraceId", "select": [{ "aggFn": "count", "where": "SeverityText:ERROR" }], ' +
      '"onClick": { "type": "search", "source": { "mode": "id", "sourceId": "<log source>" }, ' +
      '"filterValueTemplates": [{ "filter": "TraceId", "template": "{{TraceId}}" }] } } }',
  );
