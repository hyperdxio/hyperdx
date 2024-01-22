import { Types } from 'mongoose';
import { z } from 'zod';

import { AggFn, MetricsDataType } from '@/clickhouse';

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

export const chartSeriesSchema = z.union([
  timeChartSeriesSchema,
  tableChartSeriesSchema,
  histogramChartSeriesSchema,
  searchChartSeriesSchema,
  numberChartSeriesSchema,
  markdownChartSeriesSchema,
]);

export const chartSchema = z.object({
  id: z.string().max(32),
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
      data_source: z.enum(['events', 'metrics']).optional(),
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
    // This isn't always a Mongo ID
    id: z.string().max(32),
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

export const zLogAlert = z.object({
  source: z.literal('LOG'),
  groupBy: z.string().optional(),
  logViewId: z.string().min(1),
  message: z.string().optional(),
});

export const zChartAlert = z.object({
  source: z.literal('CHART'),
  chartId: z.string().min(1),
  dashboardId: z.string().min(1),
});

export const alertSchema = z
  .object({
    channel: zChannel,
    interval: z.enum(['1m', '5m', '15m', '30m', '1h', '6h', '12h', '1d']),
    threshold: z.number().min(0),
    type: z.enum(['presence', 'absence']),
    source: z.enum(['LOG', 'CHART']).default('LOG'),
  })
  .and(zLogAlert.or(zChartAlert));

// ==============================
// External API Alerts
// ==============================

export const externalSlackWebhookAlertChannel = z.object({
  type: z.literal('slack_webhook'),
  webhookId: objectIdSchema,
});

export const externalSearchAlertSchema = z.object({
  source: z.literal('search'),
  groupBy: z.string().optional(),
  savedSearchId: objectIdSchema,
  message: z.string().optional(),
});

export const externalChartAlertSchema = z.object({
  source: z.literal('chart'),
  chartId: z.string().min(1),
  dashboardId: objectIdSchema,
});

export const externalAlertSchema = z
  .object({
    channel: externalSlackWebhookAlertChannel,
    interval: z.enum(['1m', '5m', '15m', '30m', '1h', '6h', '12h', '1d']),
    threshold: z.number().min(0),
    threshold_type: z.enum(['above', 'below']),
    source: z.enum(['search', 'chart']).default('search'),
  })
  .and(externalSearchAlertSchema.or(externalChartAlertSchema));

export const externalAlertSchemaWithId = externalAlertSchema.and(
  z.object({
    id: objectIdSchema,
  }),
);
