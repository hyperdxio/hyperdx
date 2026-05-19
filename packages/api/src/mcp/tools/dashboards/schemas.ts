// prose-lint: allow-file
// MCP tool descriptions intentionally use the established en-dash
// separator (e.g. "Source ID – call hyperdx_list_sources") for LLM
// readability. Reformatting all separators is out of scope here.
import {
  AggregateFunctionSchema,
  DASHBOARD_CONTAINER_ID_MAX,
  DASHBOARD_MAX_CONTAINERS,
  DashboardContainerSchema,
  DashboardFilterType,
  MetricsDataType,
  SearchConditionLanguageSchema,
} from '@hyperdx/common-utils/dist/types';
import { z } from 'zod';

import { externalQuantileLevelSchema, objectIdSchema } from '@/utils/zod';

// ─── Shared tile schemas for MCP dashboard tools ─────────────────────────────
const mcpNumberFormatSchema = z
  .object({
    output: z
      .enum([
        'currency',
        'percent',
        'byte',
        'time',
        'duration',
        'number',
        'data_rate',
        'throughput',
      ])
      .describe(
        'Format category. "duration" auto-formats elapsed times as e.g. "1.2s" (use factor for input unit). ' +
          '"time" formats clock-style durations. "byte" formats as KB/MB/GB. ' +
          '"data_rate" formats as bytes/sec. "throughput" formats as count/sec. ' +
          '"currency" prepends a symbol. "percent" appends %.',
      ),
    mantissa: z
      .number()
      .int()
      .optional()
      .describe(
        'Decimal places (0–10). Not used for "time" or "duration" output.',
      ),
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
        'Input unit factor for "time" or "duration" output. ' +
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
      'Most useful: { output: "duration", factor: 0.000000001 } to auto-format nanosecond durations, ' +
      'or { output: "number", mantissa: 2, thousandSeparated: true } for clean counts.',
  );

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
    numberFormat: mcpNumberFormatSchema
      .optional()
      .describe(
        'Per-series display formatting, applied to this series only (overrides any tile-level numberFormat). ' +
          'Example: { output: "duration", factor: 0.000000001 } to render a nanosecond Duration series as human-readable time ' +
          'while leaving sibling count series unformatted.',
      ),
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

// ─── OnClick (link-out) schemas for table tiles ──────────────────────────────
const mcpOnClickFilterTemplateSchema = z
  .object({
    kind: z
      .literal('expressionTemplate')
      .describe('Literal "expressionTemplate"; only kind supported today.'),
    expression: z
      .string()
      .min(1)
      .max(10000)
      .describe(
        'Column or SQL expression the rendered template is matched against. ' +
          'Example: "ServiceName" or "SpanAttributes[\'http.route\']". Filters that ' +
          'share an expression are merged into a single IN clause on the destination.',
      ),
    template: z
      .string()
      .min(1)
      .max(10000)
      .describe(
        "Handlebars-style template rendered with the clicked row's columns. " +
          'Example: "{{ServiceName}}" pulls the row\'s ServiceName column value. ' +
          'Columns can be referenced by series alias.',
      ),
  })
  .describe(
    'One templated equality filter applied on the destination page. ' +
      'Use filters to pre-populate the destination search/dashboard with a row-driven ' +
      'IN clause (e.g. "ServiceName IN (\'api\')") rather than dropping the user into ' +
      'an unscoped view.',
  );

const mcpOnClickTargetSchema = z
  .discriminatedUnion('mode', [
    z
      .object({
        mode: z.literal('id'),
        id: z
          .string()
          .min(1)
          .describe(
            'Concrete source ID (for type=search) or dashboard ID (for type=dashboard). ' +
              'Get source IDs from hyperdx_list_sources; get dashboard IDs from ' +
              'hyperdx_get_dashboard (no id arg returns the list). ' +
              'For type=search the source kind must be "log" or "trace"; the /search ' +
              'page does not render metric/session sources.',
          ),
      })
      .describe('Link to a specific source or dashboard by its concrete ID.'),
    z
      .object({
        mode: z.literal('template'),
        template: z
          .string()
          .min(1)
          .max(10000)
          .describe(
            'Handlebars-style template rendered against the clicked row, then ' +
              'resolved by NAME on the destination team. ' +
              'Example: "ServiceOverview-{{ServiceName}}" assumes a row column ServiceName whose value ' +
              'is the name of a source/dashboard. Prefer mode="id" when the target is ' +
              'known up-front; it survives renames.',
          ),
      })
      .describe(
        'Link to a source/dashboard whose name comes from a column on the clicked row.',
      ),
  ])
  .describe(
    'Destination resolver. mode="id" pins a specific source/dashboard; ' +
      'mode="template" picks one at click time from a row column.' +
      "Linking by ID is preferred, but using a template is valid when the destination dashboard depends on the clicked row's content",
  );

const mcpOnClickSearchSchema = z
  .object({
    type: z
      .literal('search')
      .describe('Link to the /search page for a log or trace source.'),
    target: mcpOnClickTargetSchema,
    whereTemplate: z
      .string()
      .max(10000)
      .optional()
      .describe(
        'Optional Handlebars-style WHERE template rendered against the clicked row ' +
          "and placed in the destination's `where` query param. " +
          'Example: "ServiceName = \'{{service.name}}\'" pulls service.name from the row. ' +
          'Use Lucene or SQL syntax matching `whereLanguage`. Prefer `filters` (below) ' +
          'for simple equality; filters merge nicely on the destination.',
      ),
    whereLanguage: SearchConditionLanguageSchema.describe(
      'Filter language for `whereTemplate` and `filters` ("lucene" or "sql"). ' +
        'Optional, but set it explicitly so the destination knows how to parse rendered ' +
        'whereTemplate / filter values.',
    ),
    filters: z
      .array(mcpOnClickFilterTemplateSchema)
      .max(50)
      .optional()
      .describe(
        'Optional list of templated equality filters. Each filter becomes an ' +
          "`expression IN ('rendered-value')` clause on the destination; filters that " +
          'share an expression are merged into one IN clause.',
      ),
  })
  .describe(
    'Row-click handler that opens the /search page. Use this to drill from an ' +
      'aggregated table row down to the underlying log/trace events for that row.',
  );

const mcpOnClickDashboardSchema = z
  .object({
    type: z.literal('dashboard').describe('Link to another HyperDX dashboard.'),
    target: mcpOnClickTargetSchema,
    whereTemplate: z
      .string()
      .max(10000)
      .optional()
      .describe(
        'Optional Handlebars-style WHERE template applied to the destination ' +
          "dashboard's global filter. Useful when the target dashboard exposes a single " +
          'global scope rather than per-tile filters.',
      ),
    whereLanguage: SearchConditionLanguageSchema.describe(
      'Filter language for `whereTemplate` and `filters` ("lucene" or "sql"). ' +
        'Optional, but set it explicitly so the destination knows how to parse rendered ' +
        'whereTemplate / filter values.',
    ),
    filters: z
      .array(mcpOnClickFilterTemplateSchema)
      .max(50)
      .optional()
      .describe(
        'Optional list of templated equality filters. The destination dashboard ' +
          'auto-populates its filter list with these (matched by expression), so prefer ' +
          'this over whereTemplate when the target dashboard already declares the same ' +
          'filter expressions.',
      ),
  })
  .describe(
    'Row-click handler that opens another dashboard. Use this to drill from a ' +
      'high-level overview table down to a per-service or per-endpoint dashboard.',
  );

const mcpOnClickSchema = z
  .discriminatedUnion('type', [
    mcpOnClickSearchSchema,
    mcpOnClickDashboardSchema,
  ])
  .describe(
    'Row-click navigation for tiles that render as tables (Table tiles always; ' +
      'SQL tiles only when displayType is "table"). ' +
      'type="search" links to the /search page for a log/trace source; ' +
      'type="dashboard" links to another dashboard. ' +
      'Both support Handlebars `{{column}}` templating against the clicked row ' +
      'for the target, whereTemplate, and filter values.\n\n' +
      'Examples:\n' +
      '1. Drill into search for the clicked service: \n' +
      '   { "type": "search", "target": { "mode": "id", "id": "<trace-source-id>" }, ' +
      '"whereLanguage": "sql", ' +
      '"filters": [{ "kind": "expressionTemplate", "expression": "ServiceName", ' +
      '"template": "{{ServiceName}}" }] }\n' +
      '2. Drill into a per-service dashboard: \n' +
      '   { "type": "dashboard", "target": { "mode": "id", "id": "<dashboard-id>" }, ' +
      '"whereLanguage": "sql", ' +
      '"filters": [{ "kind": "expressionTemplate", "expression": "ServiceName", ' +
      '"template": "{{ServiceName}}" }] }\n' +
      '3. Resolve the destination from the row (rare; prefer mode="id"): \n' +
      '   { "type": "dashboard", "target": { "mode": "template", "template": ' +
      '"{{TargetDashboardName}}" }, "whereLanguage": "lucene" }',
  );

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
  containerId: z
    .string()
    .min(1)
    .max(DASHBOARD_CONTAINER_ID_MAX)
    .optional()
    .describe(
      'Container this tile belongs to. Must reference the id of a container in the ' +
        'dashboard-level containers array. Omit to render the tile in the ungrouped area.',
    ),
  tabId: z
    .string()
    .min(1)
    .max(DASHBOARD_CONTAINER_ID_MAX)
    .optional()
    .describe(
      'Tab within the container this tile belongs to. Requires containerId to be set ' +
        "and must match a tab id on that container. Omit to render in the container's shell " +
        '(useful when the container has zero or one tabs, or when a tile should appear above ' +
        'the tab bar).',
    ),
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
    having: z
      .string()
      .max(10000)
      .optional()
      .describe(
        'Post-aggregation SQL HAVING expression. Example: "Count > 100" to drop ' +
          'groups with few rows, or "StatusMessage != \'\'" to drop empty-message rows ' +
          'from a groupBy: "StatusMessage" table. Mirrors the same field on the REST ' +
          'table chart config in `externalDashboardTableChartConfigSchema`.',
      ),
    orderBy: z.string().optional().describe('Sort results by this column'),
    asRatio: z.boolean().optional(),
    groupByColumnsOnLeft: z
      .boolean()
      .optional()
      .describe(
        'Render Group By columns on the left side of the table, before the series columns. ' +
          'Default false (Group By columns on the right).',
      ),
    onClick: mcpOnClickSchema.optional(),
  }),
});

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
        'Display formatting for the number value. Example: { output: "duration", factor: 0.000000001 } ' +
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

// Heatmap tiles use a dedicated select-item shape: heatmap aggregation is
// fixed internally, the chart-level discriminator is
// `displayType: 'heatmap'`, and `HeatmapSeriesEditor` does not render an
// alias input. valueExpression is required and non-empty. Mirrors
// externalDashboardHeatmapSelectItemSchema in
// `packages/api/src/utils/zod.ts` so the MCP and REST surfaces stay in
// lockstep.
const mcpHeatmapSelectItemSchema = z.object({
  valueExpression: z
    .string()
    .min(1)
    .describe(
      'Numeric column or expression to bucket. Required and must be non-empty. ' +
        'Use "Duration" for trace latency heatmaps, or any other numeric column.',
    ),
  countExpression: z
    .string()
    .optional()
    .describe(
      'Custom count expression (e.g. "count()"). Optional; defaults are applied by the renderer.',
    ),
  heatmapScaleType: z
    .enum(['log', 'linear'])
    .optional()
    .describe('Color scale: "log" or "linear"'),
});

// Heatmap tiles are builder-only and currently restricted to Trace sources
// (see HEATMAP_ALLOWED_SOURCE_KINDS in `packages/common-utils/src/guards.ts`).
// The save path runs `getHeatmapTilesWithIncompatibleSources` after schema
// validation to enforce that, mirroring the REST handler.
const mcpHeatmapTileSchema = mcpTileLayoutSchema.extend({
  config: z.object({
    displayType: z
      .literal('heatmap')
      .describe('Heatmap chart, requires a Trace source'),
    sourceId: z
      .string()
      .describe(
        'Source ID. Must be a Trace source today; use hyperdx_list_sources and ' +
          'pick one whose kind is "trace".',
      ),
    select: z
      .array(mcpHeatmapSelectItemSchema)
      .length(1)
      .describe('Exactly one heatmap series'),
    where: z
      .string()
      .optional()
      .default('')
      .describe(
        'Row-level filter applied before bucketing. Example: "level:error"',
      ),
    whereLanguage: SearchConditionLanguageSchema.optional().default('lucene'),
    numberFormat: mcpNumberFormatSchema
      .optional()
      .describe(
        'Display formatting for bucket values. Example: { output: "duration", factor: 0.000000001 } ' +
          'to format nanosecond durations as human-readable time.',
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
    onClick: mcpOnClickSchema.optional(),
  }),
});

const mcpTileSchema = z.union([
  mcpLineTileSchema,
  mcpBarTileSchema,
  mcpTableTileSchema,
  mcpNumberTileSchema,
  mcpPieTileSchema,
  mcpHeatmapTileSchema,
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
      '"groupBy": "SpanAttributes[\'http.route\']", "select": [{ "aggFn": "count" }, ' +
      '{ "aggFn": "avg", "valueExpression": "Duration", "numberFormat": { "output": "duration", "factor": 0.000000001 } }] } }\n' +
      '   (per-series numberFormat lets one column render as a duration while a sibling count column stays a plain number)\n' +
      '3. Number: { "name": "Total Requests", "config": { "displayType": "number", "sourceId": "<from list_sources>", ' +
      '"select": [{ "aggFn": "count" }], "numberFormat": { "output": "number", "average": true } } }\n' +
      '4. Number (duration): { "name": "P95 Latency", "config": { "displayType": "number", "sourceId": "<from list_sources>", ' +
      '"select": [{ "aggFn": "quantile", "level": 0.95, "valueExpression": "Duration" }], ' +
      '"numberFormat": { "output": "duration", "factor": 0.000000001 } } }\n' +
      '5. Heatmap: { "name": "Latency Heatmap", "config": { "displayType": "heatmap", "sourceId": "<from list_sources, must be a Trace source>", ' +
      '"select": [{ "valueExpression": "Duration" }], ' +
      '"numberFormat": { "output": "duration", "factor": 0.000000001 } } }',
  );

const mcpDashboardFilterSchema = z
  .object({
    id: z
      .string()
      .optional()
      .describe(
        'Filter identity. ' +
          'On UPDATE of an existing dashboard, every filter in the array MUST carry ' +
          'an id: pass the exact id returned by hyperdx_get_dashboard for any filter ' +
          'you are keeping (so saved values bound to it stay attached), and generate ' +
          'a fresh random hex/ObjectId string for any filter you are adding in this ' +
          'update. Omitting `id` on an existing filter would orphan its saved values; ' +
          'reusing an existing id for a new filter would silently overwrite the old ' +
          'one. On CREATE (no top-level `id` on the dashboard call), filter `id` may ' +
          'be omitted and one will be generated server-side.',
      ),
    type: DashboardFilterType.describe(
      'Filter type. Currently only "QUERY_EXPRESSION" is supported.',
    ),
    name: z
      .string()
      .min(1)
      .describe(
        'Human-readable filter label shown in the dashboard filter bar dropdown.',
      ),
    expression: z
      .string()
      .min(1)
      .describe(
        'Column or SQL expression this filter binds to. Example: "ServiceName" ' +
          'or "SpanAttributes[\'http.method\']". ' +
          'IMPORTANT: This is the key that table-tile onClick filters match against ' +
          'when a row click navigates here — an onClick filter whose `expression` is ' +
          "not declared in any of this dashboard's filters is silently dropped at click time. " +
          'Declare an expression here for every column you plan to drive via row-click.',
      ),
    sourceId: objectIdSchema.describe(
      'Source the filter values are pulled from (for the dropdown). ' +
        'Get IDs from hyperdx_list_sources.',
    ),
    sourceMetricType: z
      .nativeEnum(MetricsDataType)
      .optional()
      .describe(
        'Required only when `sourceId` is a Metric source — picks which metric table the ' +
          'dropdown values come from.',
      ),
    where: z
      .string()
      .optional()
      .describe(
        'Optional WHERE clause scoping the dropdown values (e.g. "level:error" in Lucene).',
      ),
    whereLanguage: SearchConditionLanguageSchema.describe(
      'Filter language for `where` ("lucene" or "sql"). Optional, but set it explicitly.',
    ),
  })
  .describe(
    'A dashboard-level filter the user can adjust in the dashboard filter bar. ' +
      'Each filter binds a label/name to a column expression on a source. ' +
      "Filters are also the contract for row-click navigation: a table tile's " +
      'onClick.filters[i].expression must match a filter declared here for the value to land.',
  );

export const mcpFiltersParam = z
  .array(mcpDashboardFilterSchema)
  .describe(
    'Optional dashboard-level filters. These define the dropdowns in the dashboard filter ' +
      'bar AND the expressions that table-tile row-click navigation can populate. ' +
      'If another tile\'s onClick targets THIS dashboard with `filters: [{ expression: "X", ... }]`, ' +
      'this array MUST declare a filter whose `expression` is "X" — otherwise the value is ' +
      'dropped on arrival and the destination opens unfiltered.\n\n' +
      'Example:\n' +
      '[\n' +
      '  { "type": "QUERY_EXPRESSION", "name": "Service", "expression": "ServiceName",\n' +
      '    "sourceId": "<trace-source-id>", "whereLanguage": "sql" }\n' +
      ']',
  );

export const mcpContainersParam = z
  .array(DashboardContainerSchema)
  .max(DASHBOARD_MAX_CONTAINERS)
  .describe(
    'Optional dashboard organization layer. Each container groups one or more tiles ' +
      'visually and may carry a tab bar. Tiles join a container by setting tile.containerId; ' +
      'tiles further select a tab by setting tile.tabId.\n\n' +
      'Rules:\n' +
      '- Container ids must be unique on the dashboard.\n' +
      '- Tab ids must be unique within a container.\n' +
      '- A tile.containerId must reference a container id in this array.\n' +
      '- A tile.tabId must reference a tab id on the same container.\n' +
      '- tile.tabId requires tile.containerId.\n\n' +
      'Container shape: { id, title, collapsed, collapsible?, bordered?, tabs? }. ' +
      '`collapsed` is required. `collapsible` and `bordered` are optional and ' +
      'persisted absent when omitted; the renderer treats absence as true. ' +
      'Two or more tabs render as a tab bar; zero or one tab renders as a plain group header.\n\n' +
      'Example:\n' +
      '[\n' +
      '  { "id": "service-health", "title": "Service Health", "collapsed": false,\n' +
      '    "tabs": [ { "id": "errors", "title": "Errors" }, { "id": "latency", "title": "Latency" } ] },\n' +
      '  { "id": "overview", "title": "Overview", "collapsed": true }\n' +
      ']',
  );
