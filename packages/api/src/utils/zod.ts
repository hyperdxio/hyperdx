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

export const numberFormatSchema = z.object({
  output: z
    .union([
      z.literal('currency'),
      z.literal('percent'),
      z.literal('byte'),
      z.literal('time'),
      z.literal('number'),
    ])
    .optional(),
  mantissa: z.number().optional(),
  thousandSeparated: z.boolean().optional(),
  average: z.boolean().optional(),
  decimalBytes: z.boolean().optional(),
  factor: z.number().optional(),
  currencySymbol: z.string().optional(),
  unit: z.string().optional(),
});

export const percentileLevelSchema = z.number().min(0).max(1).optional();

export const timeChartSeriesSchema = z.object({
  table: sourceTableSchema.optional(),
  type: z.literal('time'),
  aggFn: AggregateFunctionSchema,
  level: percentileLevelSchema,
  field: z.union([z.string(), z.undefined()]),
  where: z.string(),
  whereLanguage: z.enum(['sql', 'lucene']).optional(),
  groupBy: z.array(z.string()).max(10),
  numberFormat: numberFormatSchema.optional(),
  metricDataType: z.optional(z.nativeEnum(MetricsDataType)),
  metricName: z.string().optional(),
  displayType: z
    .union([z.literal('stacked_bar'), z.literal('line')])
    .optional(),
});

export const tableChartSeriesSchema = z.object({
  type: z.literal('table'),
  table: sourceTableSchema.optional(),
  aggFn: AggregateFunctionSchema,
  level: percentileLevelSchema,
  field: z.string().optional(),
  where: z.string(),
  whereLanguage: z.enum(['sql', 'lucene']).optional(),
  groupBy: z.array(z.string()).max(10),
  sortOrder: z.union([z.literal('desc'), z.literal('asc')]).optional(),
  numberFormat: numberFormatSchema.optional(),
  metricDataType: z.nativeEnum(MetricsDataType).optional(),
  metricName: z.string().optional(),
});

export const numberChartSeriesSchema = z.object({
  type: z.literal('number'),
  table: sourceTableSchema.optional(),
  aggFn: AggregateFunctionSchema,
  level: percentileLevelSchema,
  field: z.union([z.string(), z.undefined()]),
  where: z.string(),
  whereLanguage: z.enum(['sql', 'lucene']).optional(),
  numberFormat: numberFormatSchema.optional(),
  metricDataType: z.nativeEnum(MetricsDataType).optional(),
  metricName: z.string().optional(),
});

export const histogramChartSeriesSchema = z.object({
  table: sourceTableSchema.optional(),
  type: z.literal('histogram'),
  level: percentileLevelSchema,
  field: z.union([z.string(), z.undefined()]),
  where: z.string(),
  whereLanguage: z.enum(['sql', 'lucene']).optional(),
  metricDataType: z.nativeEnum(MetricsDataType).optional(),
  metricName: z.string().optional(),
});

export const searchChartSeriesSchema = z.object({
  type: z.literal('search'),
  fields: z.array(z.string()),
  where: z.string(),
  whereLanguage: z.enum(['sql', 'lucene']).optional(),
});

export const markdownChartSeriesSchema = z.object({
  type: z.literal('markdown'),
  content: z.string(),
});

export const externalQueryChartSeriesSchema = z.object({
  sourceId: objectIdSchema,
  dataSource: z.enum(['events', 'metrics']).optional(),
  aggFn: AggregateFunctionSchema,
  level: percentileLevelSchema,
  field: z.string().optional(),
  where: z.string(),
  whereLanguage: z.enum(['sql', 'lucene']).optional(),
  groupBy: z.array(z.string()).max(10),
  sortOrder: z.union([z.literal('desc'), z.literal('asc')]).optional(),
  metricDataType: z.nativeEnum(MetricsDataType).optional(),
  metricName: z.string().optional(),
});

export const chartSeriesSchema = z.union([
  timeChartSeriesSchema,
  tableChartSeriesSchema,
  histogramChartSeriesSchema,
  searchChartSeriesSchema,
  numberChartSeriesSchema,
  markdownChartSeriesSchema,
]);

export const chartSchema = z.object({
  // User defined ID
  id: z.string().max(36),
  name: z.string(),
  x: z.number(),
  y: z.number(),
  w: z.number(),
  h: z.number(),
  series: z.array(
    // We can't do a strict validation here since mongo and the frontend
    // have a bug where chart types will not delete extraneous properties
    // when attempting to save.
    z.object({
      type: z.enum([
        'time',
        'histogram',
        'search',
        'number',
        'table',
        'markdown',
      ]),
      table: z.string().optional(),
      aggFn: AggregateFunctionSchema.optional(),
      field: z.union([z.string(), z.undefined()]).optional(),
      fields: z.array(z.string()).optional(),
      where: z.string().optional(),
      groupBy: z.array(z.string()).optional(),
      sortOrder: z.union([z.literal('desc'), z.literal('asc')]).optional(),
      content: z.string().optional(),
      numberFormat: numberFormatSchema.optional(),
      metricDataType: z.optional(z.nativeEnum(MetricsDataType)),
      displayType: z.optional(
        z.union([z.literal('stacked_bar'), z.literal('line')]),
      ),
    }),
  ),
  seriesReturnType: z.enum(['ratio', 'column']).optional(),
});

export const externalChartSchema = z.object({
  name: z.string(),
  x: z.number(),
  y: z.number(),
  w: z.number(),
  h: z.number(),
  series: z.array(
    z.object({
      type: z.enum([
        'time',
        'histogram',
        'search',
        'number',
        'table',
        'markdown',
      ]),
      dataSource: z.enum(['events', 'metrics']).optional(),
      aggFn: AggregateFunctionSchema.optional(),
      field: z.union([z.string(), z.undefined()]).optional(),
      fields: z.array(z.string()).optional(),
      where: z.string().optional(),
      groupBy: z.array(z.string()).optional(),
      sortOrder: z.union([z.literal('desc'), z.literal('asc')]).optional(),
      content: z.string().optional(),
      numberFormat: numberFormatSchema.optional(),
      metricDataType: z.optional(z.nativeEnum(MetricsDataType)),
    }),
  ),
  asRatio: z.boolean().optional(),
});
export const externalChartSchemaWithId = externalChartSchema.and(
  z.object({
    // User defined ID
    id: z.string().max(36),
  }),
);

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
