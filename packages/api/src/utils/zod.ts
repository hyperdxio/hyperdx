import {
  AggregateFunctionSchema,
  DashboardFilterSchema,
  MetricsDataType,
  NumberFormatSchema,
  SearchConditionLanguageSchema as whereLanguageSchema,
} from '@hyperdx/common-utils/dist/types';
import { Types } from 'mongoose';
import { z } from 'zod';

import { AlertSource, AlertThresholdType } from '@/models/alert';

export const objectIdSchema = z.string().refine(val => {
  return Types.ObjectId.isValid(val);
});

export const sourceTableSchema = z.union([
  z.literal('logs'),
  z.literal('rrweb'),
  z.literal('metrics'),
]);

export type SourceTable = z.infer<typeof sourceTableSchema>;

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

export type SearchChartSeries = z.infer<typeof searchChartSeriesSchema>;

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

export type ChartSeries = z.infer<typeof chartSeriesSchema>;

export const tagsSchema = z.array(z.string().max(32)).max(50).optional();

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

// ================================
// Dashboards (new format)
// ================================

export const externalQuantileLevelSchema = z.union([
  z.literal(0.5),
  z.literal(0.9),
  z.literal(0.95),
  z.literal(0.99),
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
  });

const externalDashboardBarChartConfigSchema =
  externalDashboardTimeChartConfigSchema.extend({
    displayType: z.literal('stacked_bar'),
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
});

const externalDashboardNumberChartConfigSchema = z.object({
  displayType: z.literal('number'),
  sourceId: objectIdSchema,
  select: z.array(externalDashboardSelectItemSchema).length(1),
  numberFormat: NumberFormatSchema.optional(),
});

const externalDashboardPieChartConfigSchema = z.object({
  displayType: z.literal('pie'),
  sourceId: objectIdSchema,
  select: z.array(externalDashboardSelectItemSchema).length(1),
  groupBy: z.string().max(10000).optional(),
  numberFormat: NumberFormatSchema.optional(),
});

const externalDashboardSearchChartConfigSchema = z.object({
  displayType: z.literal('search'),
  sourceId: objectIdSchema,
  select: z.string().max(10000),
  where: z.string().max(10000).optional().default(''),
  whereLanguage: whereLanguageSchema,
});

const externalDashboardMarkdownChartConfigSchema = z.object({
  displayType: z.literal('markdown'),
  markdown: z.string().max(50000).optional(),
});

export const externalDashboardTileConfigSchema = z
  .discriminatedUnion('displayType', [
    externalDashboardLineChartConfigSchema,
    externalDashboardBarChartConfigSchema,
    externalDashboardTableChartConfigSchema,
    externalDashboardNumberChartConfigSchema,
    externalDashboardPieChartConfigSchema,
    externalDashboardMarkdownChartConfigSchema,
    externalDashboardSearchChartConfigSchema,
  ])
  .superRefine((data, ctx) => {
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

export const externalDashboardTileSchemaWithOptionalId =
  externalDashboardTileSchema.and(
    z.object({
      // User defined ID
      id: z.string().max(36).optional(),
    }),
  );

export type ExternalDashboardTileWithOptionalId = z.infer<
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
  .superRefine((tiles, ctx) => {
    const seen = new Set<string>();
    for (const tile of tiles) {
      if (tile.id && seen.has(tile.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Duplicate tile ID: ${tile.id}. Omit the ID to generate a unique one.`,
        });
      }
      if (tile.id) {
        seen.add(tile.id);
      }
    }
  });

// ==============================
// Alerts
// ==============================
export const zChannel = z.object({
  type: z.literal('webhook'),
  webhookId: z.string().min(1),
});

export const zSavedSearchAlert = z.object({
  source: z.literal(AlertSource.SAVED_SEARCH),
  groupBy: z.string().optional(),
  savedSearchId: z.string().min(1),
});

export const zTileAlert = z.object({
  source: z.literal(AlertSource.TILE),
  tileId: z.string().min(1),
  dashboardId: z.string().min(1),
});

export const alertSchema = z
  .object({
    channel: zChannel,
    interval: z.enum(['1m', '5m', '15m', '30m', '1h', '6h', '12h', '1d']),
    threshold: z.number().min(0),
    thresholdType: z.nativeEnum(AlertThresholdType),
    source: z.nativeEnum(AlertSource).default(AlertSource.SAVED_SEARCH),
    name: z.string().min(1).max(512).nullish(),
    message: z.string().min(1).max(4096).nullish(),
  })
  .and(zSavedSearchAlert.or(zTileAlert));
