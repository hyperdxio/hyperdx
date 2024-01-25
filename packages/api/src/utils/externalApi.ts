import { z } from 'zod';

import type { IDashboard } from '@/models/dashboard';
import {
  chartSchema,
  externalChartSchema,
  externalChartSchemaWithId,
  histogramChartSeriesSchema,
  markdownChartSeriesSchema,
  numberChartSeriesSchema,
  searchChartSeriesSchema,
  tableChartSeriesSchema,
  timeChartSeriesSchema,
} from '@/utils/zod';

export const translateExternalSeriesToInternalSeries = (
  s: z.infer<typeof externalChartSchema>['series'][number],
) => {
  const {
    type,
    data_source,
    aggFn,
    field,
    fields,
    where,
    groupBy,
    sortOrder,
    content,
    numberFormat,
    metricDataType,
  } = s;

  const table = data_source === 'metrics' ? 'metrics' : 'logs';

  if (type === 'time') {
    if (aggFn == null) {
      throw new Error('aggFn must be set for time chart');
    }

    const series: z.infer<typeof timeChartSeriesSchema> = {
      type: 'time',
      table,
      aggFn,
      where: where ?? '',
      groupBy: groupBy ?? [],
      ...(field ? { field } : {}),
      ...(numberFormat ? { numberFormat } : {}),
      ...(metricDataType ? { metricDataType } : {}),
    };

    return series;
  } else if (type === 'table') {
    if (aggFn == null) {
      throw new Error('aggFn must be set for table chart');
    }

    const series: z.infer<typeof tableChartSeriesSchema> = {
      type: 'table',
      table,
      aggFn,
      where: where ?? '',
      groupBy: groupBy ?? [],
      sortOrder: sortOrder ?? 'desc',
      ...(field ? { field } : {}),
      ...(numberFormat ? { numberFormat } : {}),
      ...(metricDataType ? { metricDataType } : {}),
    };

    return series;
  } else if (type === 'number') {
    if (aggFn == null) {
      throw new Error('aggFn must be set for number chart');
    }

    const series: z.infer<typeof numberChartSeriesSchema> = {
      type: 'number',
      table,
      aggFn,
      where: where ?? '',
      ...(field ? { field } : {}),
      ...(numberFormat ? { numberFormat } : {}),
      ...(metricDataType ? { metricDataType } : {}),
    };

    return series;
  } else if (type === 'histogram') {
    const series: z.infer<typeof histogramChartSeriesSchema> = {
      type: 'histogram',
      table,
      where: where ?? '',
      ...(field ? { field } : {}),
      ...(metricDataType ? { metricDataType } : {}),
    };

    return series;
  } else if (type === 'search') {
    const series: z.infer<typeof searchChartSeriesSchema> = {
      type: 'search',
      fields: fields ?? [],
      where: where ?? '',
    };

    return series;
  } else if (type === 'markdown') {
    const series: z.infer<typeof markdownChartSeriesSchema> = {
      type: 'markdown',
      content: content ?? '',
    };

    return series;
  }

  throw new Error(`Invalid chart type ${type}`);
};

export const translateExternalChartToInternalChart = (
  chartInput: z.infer<typeof externalChartSchemaWithId>,
): z.infer<typeof chartSchema> => {
  const { id, x, name, y, w, h, series, asRatio } = chartInput;
  return {
    id,
    name,
    x,
    y,
    w,
    h,
    seriesReturnType: asRatio ? 'ratio' : 'column',
    series: series.map(s => translateExternalSeriesToInternalSeries(s)),
  };
};

const translateChartDocumentToExternalChart = (
  chart: z.infer<typeof chartSchema>,
): z.infer<typeof externalChartSchemaWithId> => {
  const { id, x, name, y, w, h, series, seriesReturnType } = chart;
  return {
    id,
    name,
    x,
    y,
    w,
    h,
    asRatio: seriesReturnType === 'ratio',
    series: series.map(s => {
      const {
        type,
        table,
        aggFn,
        field,
        where,
        groupBy,
        sortOrder,
        content,
        numberFormat,
      } = s;

      return {
        type,
        data_source: table === 'metrics' ? 'metrics' : 'events',
        aggFn,
        field,
        where,
        groupBy,
        sortOrder,
        content,
        numberFormat,
      };
    }),
  };
};

export const translateDashboardDocumentToExternalDashboard = (
  dashboard: IDashboard,
): {
  id: string;
  name: string;
  charts: z.infer<typeof externalChartSchemaWithId>[];
  query: string;
  tags: string[];
} => {
  const { _id, name, charts, query, tags } = dashboard;

  return {
    id: _id.toString(),
    name,
    charts: charts.map(translateChartDocumentToExternalChart),
    query,
    tags,
  };
};
