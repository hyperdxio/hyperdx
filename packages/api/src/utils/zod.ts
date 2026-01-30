import { AggregateFunctionSchema } from '@hyperdx/common-utils/dist/types';
import { MetricsDataType } from '@hyperdx/common-utils/dist/types';
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

// ==============================
// Charts
// ==============================

const numberFormatSchema = z.object({
  output: z.union([
    z.literal('currency'),
    z.literal('percent'),
    z.literal('byte'),
    z.literal('time'),
    z.literal('number'),
  ]),
  mantissa: z.number().optional(),
  thousandSeparated: z.boolean().optional(),
  average: z.boolean().optional(),
  decimalBytes: z.boolean().optional(),
  factor: z.number().optional(),
  currencySymbol: z.string().optional(),
  unit: z.string().optional(),
});

const percentileLevelSchema = z.number().min(0).max(1).optional();

const whereLanguageSchema = z.enum(['sql', 'lucene']).optional();

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
  numberFormat: numberFormatSchema.optional(),
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
  numberFormat: numberFormatSchema.optional(),
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
  numberFormat: numberFormatSchema.optional(),
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
  content: z.string(),
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

export const externalDashboardTileSchema = z.object({
  name: z.string(),
  x: z.number().min(0).max(23),
  y: z.number().min(0),
  w: z.number().min(1).max(24),
  h: z.number().min(1),
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
    }),
  asRatio: z.boolean().optional(),
});

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

export const tagsSchema = z.array(z.string().max(32)).max(50).optional();

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
