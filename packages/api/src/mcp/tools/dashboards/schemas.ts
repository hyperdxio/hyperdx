// prose-lint: allow-file
// MCP tool descriptions intentionally use the established en-dash
// separator (e.g. "Source ID – call clickstack_list_sources") for LLM
// readability. Reformatting all separators is out of scope here.
import {
  AggregateFunctionSchema,
  BackgroundChartSchema,
  ChartPaletteTokenSchema,
  DASHBOARD_CONTAINER_ID_MAX,
  DASHBOARD_MAX_CONTAINERS,
  DashboardContainerSchema,
  DashboardFilterType,
  MetricsDataType,
  NumberTileColorConditionSchema,
  SearchConditionTrimmedLanguageSchema,
} from '@hyperdx/common-utils/dist/types';
import { z } from 'zod';

import { getMetricSelectIssues } from '@/mcp/tools/query/schemas';
import { QUERYABLE_METRIC_KINDS } from '@/mcp/tools/sources/metricKinds';
import {
  externalQuantileLevelSchema,
  objectIdSchema,
  tagsSchema,
} from '@/utils/zod';

/**
 * Metric type values exposed on dashboard tile select items. Restricted to
 * the three kinds the query renderer can translate today; summary and
 * exponential histogram are intentionally excluded. Imports the shared
 * `QUERYABLE_METRIC_KINDS` source-of-truth tuple from `../sources/metricKinds`.
 */
const mcpTileMetricTypeSchema = z.enum(QUERYABLE_METRIC_KINDS);

// ─── Shared tile schemas for MCP dashboard tools ─────────────────────────────

const seriesLevelNumberFormatDescription =
  'Per-series display formatting, applied to this series only (overrides any tile-level numberFormat). ' +
  'Controls how the series number value(s) are formatted for display. ' +
  'Most useful: { output: "duration", factor: 0.000000001 } to auto-format nanosecond durations, ' +
  'or { output: "number", mantissa: 2, thousandSeparated: true } for clean counts.';

const tileLevelNumberFormatDescription =
  'Controls how the number value(s) are formatted for display. Applies to series or numbers without a series-level numberFormat. ' +
  'Most useful: { output: "duration", factor: 0.000000001 } to auto-format nanosecond durations, ' +
  'or { output: "number", mantissa: 2, thousandSeparated: true } for clean counts.';

const numberTileColorDescription =
  'Static color for the displayed number, as a palette token such as ' +
  '"chart-blue", "chart-green", or "chart-success" (see the enum for the ' +
  'full set). Applied unless a colorRules entry matches the value.';

const numberTileColorRulesDescription =
  'Conditional colors for the number, evaluated in array order with the ' +
  'last matching rule winning; falls back to color (then the default text ' +
  'color) when none match. Up to 10 rules. Each rule is ' +
  '{ operator, value, color, label? }: operator gt | gte | lt | lte with a ' +
  'number value, between with a [min, max] value, or eq | neq with a number ' +
  'or string value. color is a palette token. Example: ' +
  '[{ operator: "gte", value: 500, color: "chart-error", label: "Critical" }].';

const rawSqlNumberTileColorDescription =
  'Static color for the displayed number, as a palette token such as ' +
  '"chart-blue" or "chart-success". Valid only when displayType is ' +
  '"number", ignored otherwise. Raw SQL number tiles do not support ' +
  'conditional colorRules.';

const numberTileBackgroundChartDescription =
  'Optional background trend sparkline drawn behind the number, derived ' +
  'from a time-bucketed version of the same query (useful for SLO / ' +
  'error-budget tiles where the trend over the window matters). ' +
  '{ type, color? }: type is "line" or "area"; color is an optional ' +
  'palette token override (the sparkline inherits the tile color when ' +
  'unset). Builder number tiles only; raw SQL number tiles have no time ' +
  'dimension to bucket. Example: { type: "area", color: "chart-blue" }.';

const mcpNumberFormatSchema = z.object({
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
        '"currency" prepends a symbol. "percent" appends %, and divides the value by 100 (0.5 becomes 50%).',
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
});

const mcpTileSelectItemSchema = z
  .object({
    aggFn: AggregateFunctionSchema.describe(
      'Aggregation function. "count" requires no valueExpression; all others do. ' +
        'METRIC SOURCES: "increase" computes the per-bucket counter increase for Sum metrics ' +
        '(reset-aware). For Gauges use last_value/avg/min/max. For Histograms use "quantile" ' +
        'with level or "count".',
    ),
    valueExpression: z
      .string()
      .optional()
      .describe(
        'Column or expression to aggregate. Required for all aggFn except "count". ' +
          'Use PascalCase for top-level columns (e.g. "Duration", "StatusCode"). ' +
          "For span attributes use: SpanAttributes['key'] (e.g. SpanAttributes['http.method']). " +
          "For resource attributes use: ResourceAttributes['key'] (e.g. ResourceAttributes['service.name']).\n\n" +
          'METRIC SOURCES: optional — defaults to "Value" (the metric value column) when ' +
          'metricType/metricName are set.',
      ),
    where: z
      .string()
      .optional()
      .default('')
      .describe('Filter in Lucene syntax. Example: "level:error"'),
    whereLanguage:
      SearchConditionTrimmedLanguageSchema.optional().default('lucene'),
    alias: z
      .string()
      .optional()
      .describe(
        'Display label for this series — used in chart legends, table column headers, CSV exports, and onClick templates. ' +
          'Always set a short, human-readable alias (e.g. "Requests", "P95 Latency", "Error Rate"). ' +
          'Without an alias the UI shows the raw ClickHouse expression (e.g. count(), quantile(0.95)(Duration)) which is hard to read. ' +
          'Heatmap select items are the only exception (no alias needed).',
      ),
    level: externalQuantileLevelSchema
      .optional()
      .describe(
        'Percentile level for aggFn="quantile". REQUIRED for histogram metrics with aggFn:"quantile".',
      ),
    numberFormat: mcpNumberFormatSchema
      .optional()
      .describe(seriesLevelNumberFormatDescription),
    metricType: mcpTileMetricTypeSchema
      .optional()
      .describe(
        'METRIC SOURCES ONLY. OTel metric kind: gauge, sum, or histogram. ' +
          'Required (with metricName) when the tile sourceId is a metric source. ' +
          'summary and exponential histogram are not supported by the renderer yet.',
      ),
    metricName: z
      .string()
      .optional()
      .describe(
        'METRIC SOURCES ONLY. OTel metric name (e.g. "system.cpu.utilization"). ' +
          'Required when metricType is set.',
      ),
    isDelta: z
      .boolean()
      .optional()
      .describe(
        'METRIC SOURCES ONLY (gauge metrics). When true, computes the Prometheus-style ' +
          'delta over each bucket. Default false.',
      ),
  })
  .superRefine((data, ctx) => {
    const narrow = {
      aggFn: typeof data.aggFn === 'string' ? data.aggFn : undefined,
      metricType:
        typeof data.metricType === 'string' ? data.metricType : undefined,
      metricName:
        typeof data.metricName === 'string' ? data.metricName : undefined,
      isDelta: typeof data.isDelta === 'boolean' ? data.isDelta : undefined,
      level: typeof data.level === 'number' ? data.level : undefined,
      valueExpression:
        typeof data.valueExpression === 'string'
          ? data.valueExpression
          : undefined,
    };
    for (const issue of getMetricSelectIssues(narrow)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: issue.path,
        message: issue.message,
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
              'Get source IDs from clickstack_list_sources; get dashboard IDs from ' +
              'clickstack_get_dashboard (no id arg returns the list). ' +
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
    whereLanguage: SearchConditionTrimmedLanguageSchema.describe(
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
    type: z
      .literal('dashboard')
      .describe('Link to another ClickStack dashboard.'),
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
    whereLanguage: SearchConditionTrimmedLanguageSchema.describe(
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
          'filter expressions. ' +
          'If the destination dashboard does not declare a top-level filter whose ' +
          '`expression` matches, that value is dropped at click time and the ' +
          'destination opens unfiltered for that expression.',
      ),
  })
  .describe(
    'Row-click handler that opens another dashboard. Use this to drill from a ' +
      'high-level overview table down to a per-service or per-endpoint dashboard.',
  );

const mcpOnClickExternalSchema = z
  .object({
    type: z
      .literal('external')
      .describe('Link to an arbitrary external URL (e.g. Grafana, Langfuse).'),
    urlTemplate: z
      .string()
      .min(1)
      .max(10000)
      .describe(
        'Handlebars-style template rendered against the clicked row, e.g. ' +
          '"https://example.com/d/abc?var-service={{ServiceName}}". ' +
          'The rendered value MUST be an absolute http(s) URL; relative URLs and ' +
          'non-http(s) schemes (javascript:, data:, etc.) are rejected at click time. ' +
          'This variant references no HyperDX source or dashboard.',
      ),
  })
  .describe(
    'Row-click handler that opens an external URL in a new tab. Use this to ' +
      'link out to a third-party tool (Grafana, Langfuse, runbooks, etc.).',
  );

const mcpOnClickSchema = z
  .discriminatedUnion('type', [
    mcpOnClickSearchSchema,
    mcpOnClickDashboardSchema,
    mcpOnClickExternalSchema,
  ])
  .describe(
    'Row-click navigation for tiles that render as tables (Table tiles always; ' +
      'SQL tiles only when displayType is "table"). ' +
      'type="search" links to the /search page for a log/trace source; ' +
      'type="dashboard" links to another dashboard; ' +
      'type="external" links to an arbitrary external http(s) URL. ' +
      'All support Handlebars `{{column}}` templating against the clicked row ' +
      'for the target/url, whereTemplate, and filter values.\n\n' +
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
      '"{{TargetDashboardName}}" }, "whereLanguage": "lucene" }\n' +
      '4. Link out to an external tool: \n' +
      '   { "type": "external", "urlTemplate": ' +
      '"https://grafana.example.com/d/abc?var-service={{ServiceName}}" }',
  );

const mcpTileLayoutSchema = z.object({
  name: z.string().min(1).describe('Tile title shown on the dashboard'),
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
    .describe(
      'Width in grid columns (1-24; a full row is 24). Default 12. ' +
        'Match the width to the displayType: number 6-8 (three or four KPIs per row), ' +
        'line / stacked_bar / pie 8-12, heatmap 12, table / search 12-24 (often the full row). ' +
        'A markdown note is usually full-width (24).',
    ),
  h: z
    .number()
    .min(1)
    .optional()
    .default(4)
    .describe(
      'Height in grid rows. Default 4. ' +
        'Match the height to the displayType so content is not clipped: number 3-4, ' +
        'line / stacked_bar / pie 4-6, heatmap 5-6, table / search 6-10 (taller when more rows are expected), ' +
        'markdown 2-3 for a short note (h: 1 clips the text).',
    ),
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
    sourceId: z.string().describe('Source ID – call clickstack_list_sources'),
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
    numberFormat: mcpNumberFormatSchema
      .optional()
      .describe(tileLevelNumberFormatDescription),
    compareToPreviousPeriod: z
      .boolean()
      .optional()
      .describe('Overlay the previous period as a dashed comparison series.'),
    fitYAxisToData: z
      .boolean()
      .optional()
      .describe(
        'Scale the y-axis to the data range instead of starting at zero.',
      ),
  }),
});

const mcpBarTileSchema = mcpTileLayoutSchema.extend({
  config: z.object({
    displayType: z
      .literal('stacked_bar')
      .describe('Stacked bar chart over time'),
    sourceId: z.string().describe('Source ID – call clickstack_list_sources'),
    select: z.array(mcpTileSelectItemSchema).min(1).max(20),
    groupBy: z.string().optional(),
    fillNulls: z.boolean().optional().default(true),
    alignDateRangeToGranularity: z.boolean().optional(),
    asRatio: z.boolean().optional(),
    numberFormat: mcpNumberFormatSchema
      .optional()
      .describe(tileLevelNumberFormatDescription),
  }),
});

const mcpTableTileSchema = mcpTileLayoutSchema.extend({
  config: z.object({
    displayType: z.literal('table').describe('Tabular aggregated data'),
    sourceId: z.string().describe('Source ID – call clickstack_list_sources'),
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
    orderBy: z
      .string()
      .optional()
      .describe(
        'Sort results by this column. ' +
          'When ordering by an alias that contains spaces or special characters, ' +
          `wrap the alias in quotes: e.g. '"P95 Latency" DESC'.`,
      ),
    asRatio: z.boolean().optional(),
    groupByColumnsOnLeft: z
      .boolean()
      .optional()
      .describe(
        'Render Group By columns on the left side of the table, before the series columns. ' +
          'Default false (Group By columns on the right).',
      ),
    numberFormat: mcpNumberFormatSchema
      .optional()
      .describe(tileLevelNumberFormatDescription),
    onClick: mcpOnClickSchema.optional(),
  }),
});

const mcpNumberTileSchema = mcpTileLayoutSchema.extend({
  config: z.object({
    displayType: z.literal('number').describe('Single aggregate scalar value'),
    sourceId: z.string().describe('Source ID – call clickstack_list_sources'),
    select: z
      .array(mcpTileSelectItemSchema)
      .length(1)
      .describe('Exactly one metric to display'),
    numberFormat: mcpNumberFormatSchema
      .optional()
      .describe(tileLevelNumberFormatDescription),
    color: ChartPaletteTokenSchema.optional().describe(
      numberTileColorDescription,
    ),
    colorRules: z
      .array(NumberTileColorConditionSchema)
      .max(10)
      .optional()
      .describe(numberTileColorRulesDescription),
    backgroundChart: BackgroundChartSchema.optional().describe(
      numberTileBackgroundChartDescription,
    ),
  }),
});

const mcpPieTileSchema = mcpTileLayoutSchema.extend({
  config: z.object({
    displayType: z.literal('pie').describe('Pie chart'),
    sourceId: z.string().describe('Source ID – call clickstack_list_sources'),
    select: z.array(mcpTileSelectItemSchema).length(1),
    groupBy: z
      .string()
      .optional()
      .describe(
        'Column that defines pie slices. Use PascalCase for top-level columns. ' +
          "For attributes: SpanAttributes['key'] or ResourceAttributes['key'].",
      ),
    numberFormat: mcpNumberFormatSchema
      .optional()
      .describe(tileLevelNumberFormatDescription),
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
        'Source ID. Must be a Trace source today; use clickstack_list_sources and ' +
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
    whereLanguage:
      SearchConditionTrimmedLanguageSchema.optional().default('lucene'),
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
    sourceId: z.string().describe('Source ID – call clickstack_list_sources'),
    where: z
      .string()
      .optional()
      .default('')
      .describe('Filter in Lucene syntax. Example: "level:error"'),
    whereLanguage:
      SearchConditionTrimmedLanguageSchema.optional().default('lucene'),
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
        'Connection ID (not sourceId) – call clickstack_list_sources to find available connections',
      ),
    sourceId: z
      .string()
      .optional()
      .describe(
        'Source ID for the table this query reads from (call clickstack_list_sources). ' +
          'ALWAYS set this for raw SQL tiles UNLESS the query reads from multiple tables ' +
          '(e.g. JOINs or sub-queries spanning several sources), in which case omit it. ' +
          'sourceId is REQUIRED by two macros: $__filters and $__sourceTable. ' +
          'The sourceId must belong to the same connection as connectionId.',
      ),
    sqlTemplate: z.string().describe(`
Raw ClickHouse SQL query. SQL guidelines:

1. ALWAYS include a LIMIT clause to avoid excessive data.
2. ALWAYS include a date/time filter in the WHERE clause using either macros or raw parameters to ensure the chart responds to user selected time range.
    - $__timeFilter(col) expands to col >= toDateTime(fromUnixTimestamp64Milli({startDateMilliseconds:Int64})) AND col <= toDateTime(fromUnixTimestamp64Milli({endDateMilliseconds:Int64}))
    - $__timeFilter_ms(col) is the same but should be used when col has millisecond precision (DateTime64 type)
    - $__dateFilter(col) is the same but should be used when col has Day granularity (Date type)
    - $__dateTimeFilter(dateCol, dateTimeCol) should be used when there are both Date and DateTime columns that should be filtered on.
    - NEVER hardcode a fixed time range unless the user specifically asks for it.
    - $__fromTime and $__toTime can be expanded to {startDateMilliseconds:Int64} and {endDateMilliseconds:Int64}, but prefer the full filter macros for readability.
3. ALWAYS include a granularity macro or parameter for time series (line or bar charts) to ensure the chart's granularity responds to user selected time bucket size.
    - $__timeInterval(col) expands to toStartOfInterval(TimestampTime, INTERVAL {intervalSeconds:Int64} second)
    - $__interval_s expands to {intervalSeconds:Int64}
    - These macros are only available for time-series charts; do not use them for other display types.
4. STRONGLY RECOMMENDED: use the $__filters and $__sourceTable macros to ensure the tile reacts to dashboard-level filters and source selectors.
    - $__filters and $__sourceTable both require sourceId to be set on this tile.

Example:

SELECT
  $__timeInterval(TimestampTime) AS ts,
  count()
FROM $__sourceTable
WHERE $__timeFilter(TimestampTime)
  AND $__filters
GROUP BY ServiceName, ts
`),
    fillNulls: z.boolean().optional(),
    alignDateRangeToGranularity: z.boolean().optional(),
    numberFormat: mcpNumberFormatSchema
      .optional()
      .describe(tileLevelNumberFormatDescription),
    compareToPreviousPeriod: z
      .boolean()
      .optional()
      .describe(
        'Overlay the previous period as a dashed comparison series. ' +
          'Valid only when displayType is "line", ignored otherwise.',
      ),
    fitYAxisToData: z
      .boolean()
      .optional()
      .describe(
        'Scale the y-axis to the data range instead of starting at zero. ' +
          'Valid only when displayType is "line", ignored otherwise.',
      ),
    color: ChartPaletteTokenSchema.optional().describe(
      rawSqlNumberTileColorDescription,
    ),
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

// Layout schema without defaults for the patch tool: layout fields stay
// truly `undefined` when omitted so the merge logic can fall back to the
// existing tile's values instead of Zod filling in 0/12/4.
const mcpPatchTileLayoutSchema = z.object({
  name: z
    .string()
    .min(1)
    .optional()
    .describe('Tile title. Omit to keep the existing title.'),
  x: z.number().min(0).max(23).optional(),
  y: z.number().min(0).optional(),
  w: z.number().min(1).max(24).optional(),
  h: z.number().min(1).optional(),
  containerId: z.string().min(1).max(DASHBOARD_CONTAINER_ID_MAX).optional(),
  tabId: z.string().min(1).max(DASHBOARD_CONTAINER_ID_MAX).optional(),
});

// Build the patch tile union by extending the default-free layout with
// each tile type's config shape. We only need the `config` field from
// each tile schema; the layout wrapper is replaced.
const mcpPatchTileSchema = z.union([
  mcpPatchTileLayoutSchema.extend({ config: mcpLineTileSchema.shape.config }),
  mcpPatchTileLayoutSchema.extend({ config: mcpBarTileSchema.shape.config }),
  mcpPatchTileLayoutSchema.extend({ config: mcpTableTileSchema.shape.config }),
  mcpPatchTileLayoutSchema.extend({
    config: mcpNumberTileSchema.shape.config,
  }),
  mcpPatchTileLayoutSchema.extend({ config: mcpPieTileSchema.shape.config }),
  mcpPatchTileLayoutSchema.extend({
    config: mcpHeatmapTileSchema.shape.config,
  }),
  mcpPatchTileLayoutSchema.extend({
    config: mcpSearchTileSchema.shape.config,
  }),
  mcpPatchTileLayoutSchema.extend({
    config: mcpMarkdownTileSchema.shape.config,
  }),
  mcpPatchTileLayoutSchema.extend({ config: mcpSqlTileSchema.shape.config }),
]);

export const mcpTilesParam = z
  .array(mcpTileSchema)
  .describe(
    'Array of dashboard tiles. Each tile needs a name, optional layout (x/y/w/h), and a config block. ' +
      'The config block varies by displayType – use clickstack_list_sources for sourceId and connectionId values.\n\n' +
      'Example tiles:\n' +
      '1. Line chart: { "name": "Error Rate", "config": { "displayType": "line", "sourceId": "<from list_sources>", ' +
      '"groupBy": "ResourceAttributes[\'service.name\']", "select": [{ "aggFn": "count", "where": "StatusCode:STATUS_CODE_ERROR", "alias": "Errors" }] } }\n' +
      '2. Table: { "name": "Top Endpoints", "config": { "displayType": "table", "sourceId": "<from list_sources>", ' +
      '"groupBy": "SpanAttributes[\'http.route\']", "select": [{ "aggFn": "count", "alias": "Requests" }, ' +
      '{ "aggFn": "avg", "valueExpression": "Duration", "alias": "Avg Duration", "numberFormat": { "output": "duration", "factor": 0.000000001 } }] } }\n' +
      '   (per-series numberFormat lets one column render as a duration while a sibling count column stays a plain number)\n' +
      '3. Number: { "name": "Total Requests", "config": { "displayType": "number", "sourceId": "<from list_sources>", ' +
      '"select": [{ "aggFn": "count", "alias": "Requests" }], "numberFormat": { "output": "number", "average": true } } }\n' +
      '4. Number (duration): { "name": "P95 Latency", "config": { "displayType": "number", "sourceId": "<from list_sources>", ' +
      '"select": [{ "aggFn": "quantile", "level": 0.95, "valueExpression": "Duration", "alias": "P95 Latency" }], ' +
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
          'an id: pass the exact id returned by clickstack_get_dashboard for any filter ' +
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
          'when a row click navigates here. An onClick filter whose `expression` is ' +
          "not declared in any of this dashboard's filters is silently dropped at click time. " +
          'Declare an expression here for every column you plan to drive via row-click.',
      ),
    sourceId: objectIdSchema.describe(
      'Source the filter values are pulled from (for the dropdown). ' +
        'Get IDs from clickstack_list_sources.',
    ),
    sourceMetricType: z
      .nativeEnum(MetricsDataType)
      .optional()
      .describe(
        'Required only when `sourceId` is a Metric source; picks which metric table the ' +
          'dropdown values come from.',
      ),
    where: z
      .string()
      .optional()
      .describe(
        'Optional WHERE clause scoping the dropdown values (e.g. "level:error" in Lucene).',
      ),
    whereLanguage: SearchConditionTrimmedLanguageSchema.describe(
      'Filter language for `where` ("lucene" or "sql"). Optional, but set it explicitly.',
    ),
    appliesToSourceIds: z
      .array(objectIdSchema)
      .optional()
      .describe(
        'Optional list of source IDs that this filter is applied to. ' +
          'Omit (or pass `undefined`) to apply the filter to ALL tiles regardless of source ' +
          '— this is the recommended default. ' +
          'A non-empty array restricts the filter to only tiles whose source ID is in the list; ' +
          'tiles on other sources are not affected by the dropdown value at all. ' +
          'Useful on mixed-source dashboards where a column (e.g. SpanName) only exists on ' +
          'a subset of sources.',
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
      'this array MUST declare a filter whose `expression` is "X". Otherwise the value is ' +
      'dropped on arrival and the destination opens unfiltered.\n\n' +
      'By default a filter applies to every tile on the dashboard. On mixed-source dashboards, ' +
      'use the optional `appliesToSourceIds` field to restrict a filter to only the tiles whose ' +
      'source carries the referenced column — leave `appliesToSourceIds` omitted to keep the ' +
      'broadcast-to-all-tiles default.\n\n' +
      'Example (broadcast to every tile):\n' +
      '[\n' +
      '  { "type": "QUERY_EXPRESSION", "name": "Service", "expression": "ServiceName",\n' +
      '    "sourceId": "<trace-source-id>", "whereLanguage": "sql" }\n' +
      ']\n\n' +
      'Example (scoped on a mixed log/trace/metric dashboard):\n' +
      '[\n' +
      '  { "type": "QUERY_EXPRESSION", "name": "Service", "expression": "SpanName",\n' +
      '    "sourceId": "<trace-source-id>", "whereLanguage": "sql",\n' +
      '    "appliesToSourceIds": ["<trace-source-id>"] }\n' +
      ']',
  );

export const mcpPatchDashboardSchema = z.object({
  dashboardId: objectIdSchema.describe('Dashboard ID.'),
  name: z
    .string()
    .min(1)
    .optional()
    .describe('New dashboard name. Omit to keep the current name.'),
  tags: tagsSchema.describe(
    'New tags array (replaces all existing tags). Omit to keep the current tags.',
  ),
  tileId: z
    .string()
    .optional()
    .describe(
      'ID of the tile to replace. Must be paired with `tile`. ' +
        'Obtain tile IDs from clickstack_get_dashboard.',
    ),
  tile: mcpPatchTileSchema
    .optional()
    .describe(
      'The full replacement tile definition. Replaces the tile matched by tileId. ' +
        'Layout fields (x, y, w, h), name, and containerId/tabId default to the ' +
        "existing tile's values when omitted, so you only need to specify what changed.",
    ),
});

export const mcpSearchDashboardsSchema = z.object({
  query: z
    .string()
    .max(200)
    .optional()
    .describe(
      'Search term to match against dashboard names (case-insensitive substring match).',
    ),
  tags: z
    .array(z.string().min(1))
    .optional()
    .describe('Filter to dashboards that have ALL of these tags.'),
});

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
