// @ts-nocheck TODO: Fix When Restoring Alerts
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
    dataSource,
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

  const table = dataSource === 'metrics' ? 'metrics' : 'logs';

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
        dataSource: table === 'metrics' ? 'metrics' : 'events',
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

export type ExternalDashboard = {
  id: string;
  name: string;
  tiles: ExternalChart[];
  tags?: string[];
};

export type ExternalDashboardRequest = {
  name: string;
  tiles: ExternalChart[];
  tags?: string[];
};

export function translateDashboardDocumentToExternalDashboard(
  dashboard: Pick<IDashboard, '_id' | 'name' | 'tiles' | 'tags'>,
): ExternalDashboard {
  return {
    id: dashboard._id.toString(),
    name: dashboard.name,
    tiles: dashboard.tiles,
    tags: dashboard.tags || [],
  };
}

// Alert related types and transformations
export type ExternalAlert = {
  id: string;
  name: string | null;
  message: string | null;
  threshold: number;
  interval: string;
  thresholdType: string;
  source: string;
  state: string;
  channel: any;
  team: string;
  tileId?: string;
  dashboard?: string;
  savedSearch?: string;
  groupBy?: string;
  silenced?: any;
  createdAt: string;
  updatedAt: string;
};

export function translateAlertDocumentToExternalAlert(
  alert: any,
): ExternalAlert {
  // Convert to plain object if it's a Mongoose document
  const alertObj = alert.toJSON ? alert.toJSON() : { ...alert };

  // Copy all fields, renaming _id to id, ensuring ObjectId's are strings
  const result = {
    id: alertObj._id.toString(),
    name: alertObj.name,
    message: alertObj.message,
    threshold: alertObj.threshold,
    interval: alertObj.interval,
    thresholdType: alertObj.thresholdType,
    source: alertObj.source,
    state: alertObj.state,
    channel: alertObj.channel,
    team: alertObj.team.toString(),
    tileId: alertObj.tileId,
    dashboard: alertObj.dashboard?.toString(),
    savedSearch: alertObj.savedSearch?.toString(),
    groupBy: alertObj.groupBy,
    silenced: alertObj.silenced,
    createdAt: alertObj.createdAt.toISOString(),
    updatedAt: alertObj.updatedAt.toISOString(),
  };

  return result;
}
