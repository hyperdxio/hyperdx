import { z } from 'zod';

import { AggFn, MetricsDataType } from '@/clickhouse';

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

export const aggFnSchema = z.nativeEnum(AggFn);

export const sourceTableSchema = z.union([
  z.literal('logs'),
  z.literal('rrweb'),
  z.literal('metrics'),
]);

export type SourceTable = z.infer<typeof sourceTableSchema>;

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

export const chartSeriesSchema = z.union([
  timeChartSeriesSchema,
  tableChartSeriesSchema,
  z.object({
    table: z.optional(sourceTableSchema),
    type: z.literal('histogram'),
    field: z.union([z.string(), z.undefined()]),
    where: z.string(),
  }),
  z.object({
    type: z.literal('search'),
    fields: z.array(z.string()),
    where: z.string(),
  }),
  z.object({
    type: z.literal('number'),
    table: z.optional(sourceTableSchema),
    aggFn: aggFnSchema,
    field: z.union([z.string(), z.undefined()]),
    where: z.string(),
    numberFormat: numberFormatSchema.optional(),
  }),
  z.object({
    type: z.literal('markdown'),
    content: z.string(),
  }),
]);
