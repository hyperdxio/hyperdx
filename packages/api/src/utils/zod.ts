import { Types } from 'mongoose';
import { z } from 'zod';

import { AggFn, MetricsDataType } from '@/clickhouse';
import { AlertDocument, CheckerType } from '@/models/alert';

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

export const zLogAlert = z.object({
  source: z.literal('LOG'),
  groupBy: z.string().optional(),
  logViewId: z.string().min(1),
});

export const zChartAlert = z.object({
  source: z.literal('CHART'),
  chartId: z.string().min(1),
  dashboardId: z.string().min(1),
});

export const anomalyConfigSchema = z.object({
  models: z
    .array(
      z.object({
        name: z.string(),
        enabled: z.boolean(),
        params: z.record(z.any()),
      }),
    )
    .optional(),
  mode: z.union([z.literal('any'), z.literal('combined')]).optional(),
});

export const alertCheckerSchema = z.object({
  type: z.nativeEnum(CheckerType),
  config: anomalyConfigSchema.optional(), // union and add more config types here when needed
});

export const zAlertInterval = z.enum([
  '1m',
  '5m',
  '15m',
  '30m',
  '1h',
  '6h',
  '12h',
  '1d',
]);

export const zCustomAlert = z.object({
  source: z.literal('CUSTOM'),
  isSystem: z.boolean().optional(),
  customConfig: z
    .object({
      series: z.array(chartSeriesSchema),
    })
    .optional(),
  historyWindow: z.number().min(5).max(10080).optional(),
  checker: alertCheckerSchema.optional(),
});

export const alertSchema = z
  .object({
    channel: zChannel,
    interval: zAlertInterval,
    threshold: z.number().min(0),
    type: z.enum(['presence', 'absence']),
    source: z.enum(['LOG', 'CHART', 'CUSTOM']).default('LOG'),
    name: z.string().min(1).max(512).nullish(),
    message: z.string().min(1).max(4096).nullish(),
  })
  .and(zLogAlert.or(zChartAlert).or(zCustomAlert));

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
});

export const externalChartAlertSchema = z.object({
  source: z.literal('chart'),
  chartId: z.string().min(1),
  dashboardId: objectIdSchema,
});

export const externalCustomAlertSchema = z.object({
  source: z.literal('custom'),
  isSystem: z.boolean().optional(),
  customConfig: z
    .object({
      series: z.array(chartSeriesSchema),
    })
    .optional(),
  historyWindow: z.number().min(5).max(10080).optional(),
  checker: z
    .object({
      type: z.nativeEnum(CheckerType),
      config: anomalyConfigSchema.optional(), // union and add more config types here when needed
    })
    .optional(),
});

export const externalAlertSchema = z
  .object({
    channel: externalSlackWebhookAlertChannel,
    interval: z.enum(['1m', '5m', '15m', '30m', '1h', '6h', '12h', '1d']),
    threshold: z.number().min(0),
    threshold_type: z.enum(['above', 'below']),
    source: z.enum(['search', 'chart', 'custom']).default('search'),
    name: z.string().min(1).max(512).nullish(),
    message: z.string().min(1).max(4096).nullish(),
  })
  .and(
    externalSearchAlertSchema
      .or(externalChartAlertSchema)
      .or(externalCustomAlertSchema),
  );

export const externalAlertSchemaWithId = externalAlertSchema.and(
  z.object({
    id: objectIdSchema,
  }),
);

// TODO: move this to utils file since its not zod instance
export const translateExternalAlertToInternalAlert = (
  alertInput: z.infer<typeof externalAlertSchema>,
): z.infer<typeof alertSchema> => {
  return {
    interval: alertInput.interval,
    threshold: alertInput.threshold,
    type: alertInput.threshold_type === 'above' ? 'presence' : 'absence',
    channel: {
      ...alertInput.channel,
      type: 'webhook',
    },
    name: alertInput.name,
    message: alertInput.message,
    ...(alertInput.source === 'search' && alertInput.savedSearchId
      ? { source: 'LOG', logViewId: alertInput.savedSearchId }
      : alertInput.source === 'chart' && alertInput.dashboardId
      ? {
          source: 'CHART',
          dashboardId: alertInput.dashboardId,
          chartId: alertInput.chartId,
        }
      : alertInput.source === 'custom'
      ? {
          source: 'CUSTOM',
          isSystem: alertInput.isSystem,
          customConfig: alertInput.customConfig,
          checker: alertInput.checker,
        }
      : ({} as never)),
  };
};

// TODO: move this to utils file since its not zod instance
export const translateAlertDocumentToExternalAlert = (
  alertDoc: AlertDocument,
): z.infer<typeof externalAlertSchemaWithId> => {
  return {
    id: alertDoc._id.toString(),
    interval: alertDoc.interval,
    threshold: alertDoc.threshold,
    threshold_type: alertDoc.type === 'absence' ? 'below' : 'above',
    channel: {
      ...alertDoc.channel,
      type: 'slack_webhook',
    },
    name: alertDoc.name,
    message: alertDoc.message,
    ...(alertDoc.source === 'LOG' && alertDoc.logView
      ? { source: 'search', savedSearchId: alertDoc.logView.toString() }
      : alertDoc.source === 'CHART' && alertDoc.dashboardId
      ? {
          source: 'chart',
          dashboardId: alertDoc.dashboardId.toString(),
          chartId: alertDoc.chartId as string,
        }
      : alertDoc.source === 'CUSTOM'
      ? {
          source: 'custom',
          isSystem: alertDoc.isSystem,
          customConfig: alertDoc.customConfig,
          checker: alertDoc.checker,
        }
      : ({} as never)),
  };
};
