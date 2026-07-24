import {
  addDuplicateTileIdIssues,
  AggregateFunctionSchema,
  alertNoteSchema,
  AlertThresholdType,
  BackgroundChartSchema,
  ChartPaletteTokenSchema,
  DASHBOARD_CONTAINER_ID_MAX,
  DASHBOARD_MAX_TILES,
  DashboardFilterSchema,
  MAX_TAG_LENGTH,
  MAX_TAGS,
  MetricsDataType,
  NumberFormatSchema,
  NumberTileColorConditionSchema,
  OnClickDashboardSchema,
  OnClickExternalSchema,
  OnClickSearchSchema,
  scheduleStartAtSchema,
  SearchConditionLanguageSchema as whereLanguageSchema,
  tagsSchema,
  validateAlertScheduleOffsetMinutes,
  validateAlertThresholdMax,
  WebhookService,
} from '@hyperdx/common-utils/dist/types';
import { Types } from 'mongoose';
import { z } from 'zod';

import { AlertSource } from '@/models/alert';

export const objectIdSchema = z.string().refine(val => {
  return Types.ObjectId.isValid(val);
}, 'Invalid ObjectId');

// ================================
// Charts & Dashboards (old format)
// ================================

const percentileLevelSchema = z.number().min(0).max(1).optional();

const timeChartSeriesSchema = z.object({
  type: z.literal('time'),
  sourceId: objectIdSchema,
  aggFn: AggregateFunctionSchema,
  level: percentileLevelSchema,
  field: z.string().optional(),
  alias: z.string().optional(),
  where: z.string(),
  whereLanguage: whereLanguageSchema,
  groupBy: z.array(z.string()).max(10),
  numberFormat: NumberFormatSchema.optional(),
  metricDataType: z.optional(z.nativeEnum(MetricsDataType)),
  metricName: z.string().optional(),
  displayType: z
    .union([z.literal('stacked_bar'), z.literal('line')])
    .optional(),
});

export type TimeChartSeries = z.infer<typeof timeChartSeriesSchema>;

const tableChartSeriesSchema = z.object({
  type: z.literal('table'),
  sourceId: objectIdSchema,
  aggFn: AggregateFunctionSchema,
  level: percentileLevelSchema,
  field: z.string().optional(),
  alias: z.string().optional(),
  where: z.string(),
  whereLanguage: whereLanguageSchema,
  groupBy: z.array(z.string()).max(10),
  sortOrder: z.union([z.literal('desc'), z.literal('asc')]).optional(),
  numberFormat: NumberFormatSchema.optional(),
  metricDataType: z.nativeEnum(MetricsDataType).optional(),
  metricName: z.string().optional(),
});

export type TableChartSeries = z.infer<typeof tableChartSeriesSchema>;

const numberChartSeriesSchema = z.object({
  type: z.literal('number'),
  sourceId: objectIdSchema,
  aggFn: AggregateFunctionSchema,
  level: percentileLevelSchema,
  field: z.string().optional(),
  alias: z.string().optional(),
  where: z.string(),
  whereLanguage: whereLanguageSchema,
  numberFormat: NumberFormatSchema.optional(),
  metricDataType: z.nativeEnum(MetricsDataType).optional(),
  metricName: z.string().optional(),
});

export type NumberChartSeries = z.infer<typeof numberChartSeriesSchema>;

const searchChartSeriesSchema = z.object({
  type: z.literal('search'),
  sourceId: objectIdSchema,
  fields: z.array(z.string()),
  where: z.string(),
  whereLanguage: whereLanguageSchema,
});

type SearchChartSeries = z.infer<typeof searchChartSeriesSchema>;

const markdownChartSeriesSchema = z.object({
  type: z.literal('markdown'),
  content: z.string().max(100000),
});

export type MarkdownChartSeries = z.infer<typeof markdownChartSeriesSchema>;

export const externalQueryChartSeriesSchema = z.object({
  sourceId: objectIdSchema,
  dataSource: z.enum(['events', 'metrics']).optional(),
  aggFn: AggregateFunctionSchema,
  level: percentileLevelSchema,
  field: z.string().optional(),
  where: z.string(),
  whereLanguage: whereLanguageSchema,
  groupBy: z.array(z.string()).max(10),
  sortOrder: z.union([z.literal('desc'), z.literal('asc')]).optional(),
  metricDataType: z.nativeEnum(MetricsDataType).optional(),
  metricName: z.string().optional(),
});

const chartSeriesSchema = z.discriminatedUnion('type', [
  timeChartSeriesSchema,
  tableChartSeriesSchema,
  searchChartSeriesSchema,
  numberChartSeriesSchema,
  markdownChartSeriesSchema,
]);

type ChartSeries = z.infer<typeof chartSeriesSchema>;

// Re-exported from common-utils so existing `@/utils/zod` importers keep working
// while the canonical definition lives in the shared package.
export { MAX_TAG_LENGTH, MAX_TAGS, tagsSchema };

export const externalDashboardFilterSchemaWithId = DashboardFilterSchema.omit({
  source: true,
})
  .extend({ sourceId: objectIdSchema })
  .strict();

export type ExternalDashboardFilterWithId = z.infer<
  typeof externalDashboardFilterSchemaWithId
>;

export const externalDashboardFilterSchema =
  externalDashboardFilterSchemaWithId.omit({ id: true });

export type ExternalDashboardFilter = z.infer<
  typeof externalDashboardFilterSchema
>;

export const externalDashboardSavedFilterValueSchema = z.object({
  type: z.literal('sql').optional().default('sql'),
  condition: z.string().max(10000),
});

type ExternalDashboardSavedFilterValue = z.infer<
  typeof externalDashboardSavedFilterValueSchema
>;

// ================================
// Dashboards (new format)
// ================================

export const externalQuantileLevelSchema = z.union([
  z.literal(0.5),
  z.literal(0.9),
  z.literal(0.95),
  z.literal(0.99),
]);

// -----------------------------------------------------
// OnClick (link-out) schemas for table chart tiles
// -----------------------------------------------------

const externalOnClickTargetSchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('id'), id: objectIdSchema }),
  z.object({
    mode: z.literal('template'),
    template: z.string().min(1).max(10000),
  }),
]);

const externalOnClickSearchSchema = OnClickSearchSchema.extend({
  target: externalOnClickTargetSchema,
});

const externalOnClickDashboardSchema = OnClickDashboardSchema.extend({
  target: externalOnClickTargetSchema,
});

const externalOnClickExternalSchema = OnClickExternalSchema;

const externalOnClickSchema = z.discriminatedUnion('type', [
  externalOnClickSearchSchema,
  externalOnClickDashboardSchema,
  externalOnClickExternalSchema,
]);

const externalDashboardSelectItemSchema = z
  .object({
    // For logs, traces, and metrics
    valueExpression: z.string().max(10000).optional(),
    alias: z.string().max(10000).optional(),
    aggFn: AggregateFunctionSchema,
    level: externalQuantileLevelSchema.optional(),
    where: z.string().max(10000).optional().default(''),
    whereLanguage: whereLanguageSchema.optional(),
    numberFormat: NumberFormatSchema.optional(),

    // For metrics only
    metricType: z.nativeEnum(MetricsDataType).optional(),
    metricName: z.string().optional(),
    periodAggFn: z.enum(['delta']).optional(),
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

export type ExternalDashboardSelectItem = z.infer<
  typeof externalDashboardSelectItemSchema
>;

const externalDashboardRawSqlChartConfigBaseSchema = z.object({
  configType: z.literal('sql'),
  connectionId: objectIdSchema,
  sqlTemplate: z.string().max(100000),
  sourceId: objectIdSchema.optional(),
  numberFormat: NumberFormatSchema.optional(),
});

const externalDashboardTimeChartConfigSchema = z.object({
  sourceId: objectIdSchema,
  select: z.array(externalDashboardSelectItemSchema).min(1).max(20),
  groupBy: z.string().max(10000).optional(),
  asRatio: z.boolean().optional(),
  alignDateRangeToGranularity: z.boolean().optional(),
  fillNulls: z.boolean().optional(),
  numberFormat: NumberFormatSchema.optional(),
});

const externalDashboardLineChartConfigSchema =
  externalDashboardTimeChartConfigSchema.extend({
    displayType: z.literal('line'),
    compareToPreviousPeriod: z.boolean().optional(),
    fitYAxisToData: z.boolean().optional(),
  });

const externalDashboardLineRawSqlChartConfigSchema =
  externalDashboardRawSqlChartConfigBaseSchema.extend({
    displayType: z.literal('line'),
    compareToPreviousPeriod: z.boolean().optional(),
    fillNulls: z.boolean().optional(),
    alignDateRangeToGranularity: z.boolean().optional(),
    fitYAxisToData: z.boolean().optional(),
  });

const externalDashboardBarChartConfigSchema =
  externalDashboardTimeChartConfigSchema.extend({
    displayType: z.literal('stacked_bar'),
  });

const externalDashboardBarRawSqlChartConfigSchema =
  externalDashboardRawSqlChartConfigBaseSchema.extend({
    displayType: z.literal('stacked_bar'),
    fillNulls: z.boolean().optional(),
    alignDateRangeToGranularity: z.boolean().optional(),
  });

const externalDashboardTableChartConfigSchema = z.object({
  displayType: z.literal('table'),
  sourceId: objectIdSchema,
  select: z.array(externalDashboardSelectItemSchema).min(1).max(20),
  groupBy: z.string().max(10000).optional(),
  having: z.string().max(10000).optional(),
  orderBy: z.string().max(10000).optional(),
  asRatio: z.boolean().optional(),
  numberFormat: NumberFormatSchema.optional(),
  groupByColumnsOnLeft: z.boolean().optional(),
  alternateRowBackground: z.boolean().optional(),
  onClick: externalOnClickSchema.optional(),
});

const externalDashboardTableRawSqlChartConfigSchema =
  externalDashboardRawSqlChartConfigBaseSchema.extend({
    displayType: z.literal('table'),
    alternateRowBackground: z.boolean().optional(),
    onClick: externalOnClickSchema.optional(),
  });

const externalDashboardNumberRawSqlChartConfigSchema =
  externalDashboardRawSqlChartConfigBaseSchema.extend({
    displayType: z.literal('number'),
    // Raw SQL number tiles expose the same static tile color as builder
    // number tiles: the editor gates the picker on displayType, not
    // configType (`ChartDisplaySettingsDrawer`). `colorRules` is
    // intentionally omitted here because the editor's save path
    // (`convertFormStateToSavedChartConfig`) picks `color` but not
    // `colorRules` for raw SQL configs, so persisted raw SQL number tiles
    // never carry rules.
    color: ChartPaletteTokenSchema.optional(),
  });

const externalDashboardPieRawSqlChartConfigSchema =
  externalDashboardRawSqlChartConfigBaseSchema.extend({
    displayType: z.literal('pie'),
  });

// Categorical bar charts behave exactly like pie charts.
// Distinct from 'stacked_bar', which is a time series.
const externalDashboardCategoricalBarRawSqlChartConfigSchema =
  externalDashboardRawSqlChartConfigBaseSchema.extend({
    displayType: z.literal('bar'),
  });

const externalDashboardNumberChartConfigSchema = z.object({
  displayType: z.literal('number'),
  sourceId: objectIdSchema,
  select: z.array(externalDashboardSelectItemSchema).length(1),
  numberFormat: NumberFormatSchema.optional(),
  // Number-tile color authoring. Mirrors the internal
  // `SharedChartSettingsSchema` fields (common-utils types.ts), which the
  // editor gates to number tiles (`ChartDisplaySettingsDrawer`:
  // `showTileColor = displayType === DisplayType.Number`). `color` is a
  // hue-named palette token; `colorRules` are ordered conditional rules
  // (last match wins), capped at 10 to match the editor. `colorRules` uses
  // `NumberTileColorConditionSchema` (numeric and equality operators only),
  // not the full `ColorConditionSchema`, so the API cannot accept the
  // string-match or regex rules the number-tile editor never emits. Both
  // schemas are imported from common-utils so the external surface cannot
  // drift from what the UI persists.
  color: ChartPaletteTokenSchema.optional(),
  colorRules: z.array(NumberTileColorConditionSchema).max(10).optional(),
  // Optional background trend sparkline. Mirrors the internal
  // `SharedChartSettingsSchema.backgroundChart` (common-utils types.ts),
  // gated by the editor to builder number tiles
  // (`ChartDisplaySettingsDrawer`: shown for number tiles but disabled when
  // `configType === 'sql'`). The save path
  // (`convertFormStateToSavedChartConfig`) persists `backgroundChart` only on
  // the builder branch (the raw SQL / promql picks omit it), so it lives on
  // the builder number schema only, like `colorRules`. `BackgroundChartSchema`
  // is imported from common-utils so the external surface cannot drift from
  // what the UI persists.
  backgroundChart: BackgroundChartSchema.optional(),
});

const externalDashboardPieChartConfigSchema = z.object({
  displayType: z.literal('pie'),
  sourceId: objectIdSchema,
  select: z.array(externalDashboardSelectItemSchema).length(1),
  groupBy: z.string().max(10000).optional(),
  orderBy: z.string().max(10000).optional(),
  numberFormat: NumberFormatSchema.optional(),
  limit: z.number().int().positive().optional(),
});

const externalDashboardCategoricalBarChartConfigSchema = z.object({
  displayType: z.literal('bar'),
  sourceId: objectIdSchema,
  select: z.array(externalDashboardSelectItemSchema).length(1),
  groupBy: z.string().max(10000).optional(),
  orderBy: z.string().max(10000).optional(),
  numberFormat: NumberFormatSchema.optional(),
  limit: z.number().int().positive().optional(),
});

// Heatmap charts use a dedicated select item schema because they carry the
// heatmap-specific fields `countExpression` and `heatmapScaleType` from
// `DerivedColumnSchema` in common-utils, and they do not expose the line/bar
// `aggFn` or `alias`. The chart-level discriminator is
// `displayType: 'heatmap'`; the heatmap aggregation function is fixed
// internally (`count`) and `HeatmapSeriesEditor` does not render an alias
// input. `valueExpression` must be non-empty to match the editor-form rule
// (validateChartForm in
// packages/app/src/components/ChartEditor/utils.ts: "Value expression is
// required for heatmap charts").
const externalDashboardHeatmapSelectItemSchema = z.object({
  valueExpression: z.string().min(1).max(10000),
  countExpression: z.string().max(10000).optional(),
  heatmapScaleType: z.enum(['log', 'linear']).optional(),
});

export type ExternalDashboardHeatmapSelectItem = z.infer<
  typeof externalDashboardHeatmapSelectItemSchema
>;

// Heatmap exposes the row-level filter at the chart-config level (matching
// the editor: HeatmapSeriesEditor renders a single SearchWhereInput bound
// to the top-level `where` / `whereLanguage`). There is no groupBy in the
// heatmap UI (HeatmapSeriesEditor doesn't render one), so it is omitted
// from the schema.
const externalDashboardHeatmapChartConfigSchema = z.object({
  displayType: z.literal('heatmap'),
  sourceId: objectIdSchema,
  select: z.array(externalDashboardHeatmapSelectItemSchema).length(1),
  where: z.string().max(10000).optional().default(''),
  // `whereLanguageSchema` (an alias for `SearchConditionLanguageSchema`)
  // is already `.optional()` internally; sibling chart-config schemas
  // in this file (e.g. `externalDashboardSearchChartConfigSchema`) drop
  // the redundant outer `.optional()`.
  whereLanguage: whereLanguageSchema,
  numberFormat: NumberFormatSchema.optional(),
});

const externalDashboardSearchChartConfigSchema = z.object({
  displayType: z.literal('search'),
  sourceId: objectIdSchema,
  select: z.string().max(10000),
  where: z.string().max(10000).optional().default(''),
  whereLanguage: whereLanguageSchema,
});

// Extended schema for the /api/v2/search endpoint — adds orderBy which is not
// applicable to dashboard tiles.
export const externalDashboardSearchRequestSchema =
  externalDashboardSearchChartConfigSchema.extend({
    orderBy: z.string().max(1024).optional(),
  });

export type ExternalDashboardSearchRequestConfig = z.infer<
  typeof externalDashboardSearchRequestSchema
>;

const externalDashboardMarkdownChartConfigSchema = z.object({
  displayType: z.literal('markdown'),
  markdown: z.string().max(50000).optional(),
});

const externalDashboardEventPatternsChartConfigSchema = z.object({
  displayType: z.literal('event_patterns'),
  sourceId: objectIdSchema,
  select: z.string().max(10000).optional().default(''),
  where: z.string().max(10000).optional().default(''),
  whereLanguage: whereLanguageSchema,
});

const externalDashboardBuilderTileConfigSchema = z.discriminatedUnion(
  'displayType',
  [
    externalDashboardLineChartConfigSchema,
    externalDashboardBarChartConfigSchema,
    externalDashboardTableChartConfigSchema,
    externalDashboardNumberChartConfigSchema,
    externalDashboardPieChartConfigSchema,
    externalDashboardCategoricalBarChartConfigSchema,
    externalDashboardHeatmapChartConfigSchema,
    externalDashboardMarkdownChartConfigSchema,
    externalDashboardSearchChartConfigSchema,
    externalDashboardEventPatternsChartConfigSchema,
  ],
);

type ExternalDashboardBuilderTileConfig = z.infer<
  typeof externalDashboardBuilderTileConfigSchema
>;

const externalDashboardRawSqlTileConfigSchema = z.discriminatedUnion(
  'displayType',
  [
    externalDashboardLineRawSqlChartConfigSchema,
    externalDashboardBarRawSqlChartConfigSchema,
    externalDashboardTableRawSqlChartConfigSchema,
    externalDashboardNumberRawSqlChartConfigSchema,
    externalDashboardPieRawSqlChartConfigSchema,
    externalDashboardCategoricalBarRawSqlChartConfigSchema,
  ],
);

export type ExternalDashboardRawSqlTileConfig = z.infer<
  typeof externalDashboardRawSqlTileConfigSchema
>;

const externalDashboardTileConfigSchema = z
  .custom<
    ExternalDashboardRawSqlTileConfig | ExternalDashboardBuilderTileConfig
  >()
  .superRefine((data, ctx) => {
    // Route to the correct sub-schema based on configType so Zod's
    // discriminatedUnion can produce targeted field-level errors rather
    // than a generic union failure.
    const schema =
      data !== null &&
      typeof data === 'object' &&
      'configType' in data &&
      data.configType === 'sql'
        ? externalDashboardRawSqlTileConfigSchema
        : externalDashboardBuilderTileConfigSchema;

    const result = schema.safeParse(data);
    if (!result.success) {
      for (const issue of result.error.issues) {
        ctx.addIssue(issue);
      }
      return;
    }

    if (
      'asRatio' in data &&
      data.asRatio &&
      (!Array.isArray(data.select) || data.select.length !== 2)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'asRatio can only be used with exactly two select items',
      });
    }
  })
  .transform(data => {
    // Re-parse through the appropriate sub-schema to strip unknown fields.
    // Safe to call .parse() here — superRefine already validated the data,
    // so this is guaranteed to succeed.
    const schema =
      data !== null &&
      typeof data === 'object' &&
      'configType' in data &&
      data.configType === 'sql'
        ? externalDashboardRawSqlTileConfigSchema
        : externalDashboardBuilderTileConfigSchema;
    return schema.parse(data);
  });

export type ExternalDashboardTileConfig = z.infer<
  typeof externalDashboardTileConfigSchema
>;

// ================================
// Dashboards (Old + New formats)
// ================================

export const externalDashboardTileSchema = z
  .object({
    name: z.string(),
    x: z.number().min(0).max(23),
    y: z.number().min(0),
    w: z.number().min(1).max(24),
    h: z.number().min(1),
    asRatio: z.boolean().optional(),
    series: chartSeriesSchema
      .array()
      .min(1)
      .superRefine((series, ctx) => {
        const types = series.map(s => s.type);
        if (!types.every(t => t === types[0])) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'All series must have the same type',
          });
        }
      })
      .optional(),
    config: externalDashboardTileConfigSchema.optional(),
    // Bounds match the internal `DashboardContainerSchema` cap (see
    // `DASHBOARD_CONTAINER_ID_MAX` in common-utils/src/types.ts) so a
    // valid container id from the editor always fits.
    containerId: z.string().min(1).max(DASHBOARD_CONTAINER_ID_MAX).optional(),
    tabId: z.string().min(1).max(DASHBOARD_CONTAINER_ID_MAX).optional(),
  })
  .superRefine((data, ctx) => {
    if (data.series && data.config) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Tile cannot have both series and config',
      });
    } else if (!data.series && !data.config) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Tile must have either series or config',
      });
    }

    if (data.asRatio != undefined && data.config) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          'asRatio property is not supported when using config property. Specify config.asRatio instead.',
      });
    }
  });

export type ExternalDashboardTile = z.infer<typeof externalDashboardTileSchema>;

const externalDashboardTileSchemaWithOptionalId =
  externalDashboardTileSchema.and(
    z.object({
      // User defined ID
      id: z.string().max(36).optional(),
    }),
  );

type ExternalDashboardTileWithOptionalId = z.infer<
  typeof externalDashboardTileSchemaWithOptionalId
>;

export const externalDashboardTileSchemaWithId =
  externalDashboardTileSchema.and(
    z.object({
      // User defined ID
      id: z.string().max(36),
    }),
  );

export type ExternalDashboardTileWithId = z.infer<
  typeof externalDashboardTileSchemaWithId
>;

export const externalDashboardTileListSchema = z
  .array(externalDashboardTileSchemaWithOptionalId)
  // Cap the per-dashboard tile fan-out so an external-API caller can't push
  // a payload tens of MB into Mongo in one request. The 500 limit sits well
  // above any real dashboard; the dashboard editor's add-tile affordance
  // is one-at-a-time.
  .max(DASHBOARD_MAX_TILES)
  .superRefine((tiles, ctx) =>
    addDuplicateTileIdIssues(tiles, ctx, {
      messageSuffix: '. Omit the ID to generate a unique one.',
    }),
  );

// ==============================
// Alerts
// ==============================
const zChannel = z.object({
  type: z.literal('webhook'),
  webhookId: z.string().min(1),
});

const zSavedSearchAlert = z.object({
  source: z.literal(AlertSource.SAVED_SEARCH),
  groupBy: z.string().optional(),
  savedSearchId: z.string().min(1),
});

const zTileAlert = z.object({
  source: z.literal(AlertSource.TILE),
  tileId: z.string().min(1),
  dashboardId: z.string().min(1),
});

export const alertSchema = z
  .object({
    channel: zChannel,
    interval: z.enum(['1m', '5m', '15m', '30m', '1h', '6h', '12h', '1d']),
    scheduleOffsetMinutes: z.number().int().min(0).max(1439).optional(),
    scheduleStartAt: scheduleStartAtSchema,
    threshold: z.number(),
    thresholdType: z.nativeEnum(AlertThresholdType),
    thresholdMax: z.number().optional(),
    source: z.nativeEnum(AlertSource).default(AlertSource.SAVED_SEARCH),
    name: z.string().min(1).max(512).nullish(),
    message: z.string().min(1).max(4096).nullish(),
    note: alertNoteSchema,
    numConsecutiveWindows: z.number().int().min(1).nullish(),
  })
  .and(zSavedSearchAlert.or(zTileAlert))
  .superRefine(validateAlertScheduleOffsetMinutes)
  .superRefine(validateAlertThresholdMax);

// ==============================
// Webhooks
// ==============================

const baseWebhookSchema = {
  id: z.string(),
  name: z.string(),
  url: z.string().optional(),
  description: z.string().optional(),
  updatedAt: z.string(),
  createdAt: z.string(),
};

const slackWebhookSchema = z.object({
  ...baseWebhookSchema,
  service: z.literal(WebhookService.Slack),
});

const incidentIOWebhookSchema = z.object({
  ...baseWebhookSchema,
  service: z.literal(WebhookService.IncidentIO),
});

const genericWebhookSchema = z.object({
  ...baseWebhookSchema,
  service: z.literal(WebhookService.Generic),
  body: z.string().optional(),
  // headers are intentionally omitted from response schemas to avoid leaking sensitive information.
});

export const externalWebhookSchema = z.discriminatedUnion('service', [
  slackWebhookSchema,
  incidentIOWebhookSchema,
  genericWebhookSchema,
]);

export type ExternalWebhook = z.infer<typeof externalWebhookSchema>;

// Shared webhook header/query-param validators. Exported so the internal
// webhooks router (routers/api/webhooks.ts) uses the exact same rules — a single
// source of truth prevents the CRLF/control-char hardening from drifting between
// the internal and external APIs.
// Length caps for webhook write fields. These bound the stored document size so
// a webhook write can't approach Mongo's 16MB document limit as an unhandled
// error, mirroring the per-field caps on the saved-search schema.
const MAX_WEBHOOK_NAME_LENGTH = 1024;
const MAX_WEBHOOK_URL_LENGTH = 2048;
const MAX_WEBHOOK_DESCRIPTION_LENGTH = 2048;
const MAX_WEBHOOK_BODY_LENGTH = 16 * 1024;
const MAX_WEBHOOK_HEADER_NAME_LENGTH = 256;
const MAX_WEBHOOK_HEADER_VALUE_LENGTH = 4096;
const MAX_WEBHOOK_QUERY_PARAM_KEY_LENGTH = 1024;
const MAX_WEBHOOK_QUERY_PARAM_VALUE_LENGTH = 4096;
// Cap the number of header / query-param entries so an unbounded map can't blow
// up the document size even with each individual value capped.
const MAX_WEBHOOK_HEADERS = 100;
const MAX_WEBHOOK_QUERY_PARAMS = 100;

export const webhookHeaderNameSchema = z
  .string()
  .min(1, 'Header name cannot be empty')
  .max(MAX_WEBHOOK_HEADER_NAME_LENGTH)
  .regex(
    /^[!#$%&'*+\-.0-9A-Z^_`a-z|~]+$/,
    "Invalid header name. Only alphanumeric characters and !#$%&'*+-.^_`|~ are allowed",
  )
  .refine(name => !/^\d/.test(name), 'Header name cannot start with a number');

// eslint-disable-next-line no-control-regex
const hasControlChars = (val: string) => /[\r\n\t\x00-\x1F\x7F]/.test(val);

export const webhookHeaderValueSchema = z
  .string()
  .max(MAX_WEBHOOK_HEADER_VALUE_LENGTH)
  .refine(val => !hasControlChars(val), {
    message: 'Header values cannot contain control characters',
  });

// Query param keys and values are written into the outbound request URL, so they
// get the same CRLF/control-char hardening as headers. Unlike header names, query
// keys aren't HTTP tokens, so only control chars are rejected (not a token charset).
export const webhookQueryParamKeySchema = z
  .string()
  .min(1, 'Query parameter name cannot be empty')
  .max(MAX_WEBHOOK_QUERY_PARAM_KEY_LENGTH)
  .refine(val => !hasControlChars(val), {
    message: 'Query parameter names cannot contain control characters',
  });

export const webhookQueryParamValueSchema = z
  .string()
  .max(MAX_WEBHOOK_QUERY_PARAM_VALUE_LENGTH)
  .refine(val => !hasControlChars(val), {
    message: 'Query parameter values cannot contain control characters',
  });

// Fields that only take effect for services that issue a templated HTTP request
// (generic, incident.io). Slack posts a fixed Block Kit payload to its incoming
// webhook URL and ignores headers/queryParams/body entirely (see
// handleSendSlackWebhook in tasks/checkAlerts/template.ts), so supplying them on
// a slack webhook is rejected rather than silently dropped.
const SLACK_UNSUPPORTED_FIELDS = ['headers', 'queryParams', 'body'] as const;

// Request body for external webhook create/update. `headers` and `queryParams`
// are write-only: accepted here but never echoed back by externalWebhookSchema,
// so provider integrations can configure secrets without them leaking on read.
export const externalWebhookCreateSchema = z
  .object({
    name: z.string().trim().min(1).max(MAX_WEBHOOK_NAME_LENGTH),
    service: z.nativeEnum(WebhookService),
    url: z.string().url().max(MAX_WEBHOOK_URL_LENGTH),
    description: z.string().max(MAX_WEBHOOK_DESCRIPTION_LENGTH).optional(),
    queryParams: z
      .record(webhookQueryParamKeySchema, webhookQueryParamValueSchema)
      .refine(m => Object.keys(m).length <= MAX_WEBHOOK_QUERY_PARAMS, {
        message: `A webhook cannot have more than ${MAX_WEBHOOK_QUERY_PARAMS} query parameters`,
      })
      .optional(),
    headers: z
      .record(webhookHeaderNameSchema, webhookHeaderValueSchema)
      .refine(m => Object.keys(m).length <= MAX_WEBHOOK_HEADERS, {
        message: `A webhook cannot have more than ${MAX_WEBHOOK_HEADERS} headers`,
      })
      .optional(),
    body: z.string().max(MAX_WEBHOOK_BODY_LENGTH).optional(),
  })
  .superRefine((val, ctx) => {
    if (val.service !== WebhookService.Slack) {
      return;
    }
    for (const field of SLACK_UNSUPPORTED_FIELDS) {
      if (val[field] !== undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [field],
          message: `${field} is not supported for the slack webhook service`,
        });
      }
    }
  });
