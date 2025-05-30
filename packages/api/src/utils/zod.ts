import { Types } from 'mongoose';
import { z } from 'zod';

import { AggFn, MetricsDataType } from '@/clickhouse';
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

export const aggFnSchema = z.nativeEnum(AggFn);

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

export const timeChartSeriesSchema = z.object({
  table: z.optional(sourceTableSchema),
  type: z.literal('time'),
  aggFn: aggFnSchema,
  field: z.union([z.string(), z.undefined()]),
  where: z.string(),
  groupBy: z.array(z.string()).max(10),
  numberFormat: numberFormatSchema.optional(),
  metricDataType: z.optional(z.nativeEnum(MetricsDataType)),
  displayType: z.optional(
    z.union([z.literal('stacked_bar'), z.literal('line')]),
  ),
});

export const tableChartSeriesSchema = z.object({
  type: z.literal('table'),
  table: z.optional(sourceTableSchema),
  aggFn: aggFnSchema,
  field: z.optional(z.string()),
  where: z.string(),
  groupBy: z.array(z.string()).max(10),
  sortOrder: z.optional(z.union([z.literal('desc'), z.literal('asc')])),
  numberFormat: numberFormatSchema.optional(),
  metricDataType: z.optional(z.nativeEnum(MetricsDataType)),
});

export const numberChartSeriesSchema = z.object({
  type: z.literal('number'),
  table: z.optional(sourceTableSchema),
  aggFn: aggFnSchema,
  field: z.union([z.string(), z.undefined()]),
  where: z.string(),
  numberFormat: numberFormatSchema.optional(),
  metricDataType: z.optional(z.nativeEnum(MetricsDataType)),
});

export const histogramChartSeriesSchema = z.object({
  table: z.optional(sourceTableSchema),
  type: z.literal('histogram'),
  field: z.union([z.string(), z.undefined()]),
  where: z.string(),
  metricDataType: z.optional(z.nativeEnum(MetricsDataType)),
});

export const searchChartSeriesSchema = z.object({
  type: z.literal('search'),
  fields: z.array(z.string()),
  where: z.string(),
});

export const markdownChartSeriesSchema = z.object({
  type: z.literal('markdown'),
  content: z.string(),
});

export const externalQueryChartSeriesSchema = z.object({
  dataSource: z.enum(['events', 'metrics']).optional(),
  aggFn: aggFnSchema,
  field: z.optional(z.string()),
  where: z.string(),
  groupBy: z.array(z.string()).max(10),
  sortOrder: z.optional(z.union([z.literal('desc'), z.literal('asc')])),
  metricDataType: z.optional(z.nativeEnum(MetricsDataType)),
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
      aggFn: aggFnSchema.optional(),
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
      aggFn: aggFnSchema.optional(),
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
