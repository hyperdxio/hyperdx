import z from 'zod';

import {
  AggregateFunction,
  AggregateFunctionSchema,
  ChartConfigWithDateRange,
  DisplayType,
  MetricsDataType,
  NumberFormat,
  TSource,
} from '@/types';

import { getMetricNameSql } from './otelSemanticConventions';
import { Granularity } from './utils';

export enum AggFnV1 {
  avg_rate = 'avg_rate',
  avg = 'avg',
  count_distinct = 'count_distinct',
  count = 'count',
  count_per_sec = 'count_per_sec',
  count_per_min = 'count_per_min',
  count_per_hour = 'count_per_hour',
  last_value = 'last_value',
  max_rate = 'max_rate',
  max = 'max',
  min_rate = 'min_rate',
  min = 'min',
  p50_rate = 'p50_rate',
  p50 = 'p50',
  p90_rate = 'p90_rate',
  p90 = 'p90',
  p95_rate = 'p95_rate',
  p95 = 'p95',
  p99_rate = 'p99_rate',
  p99 = 'p99',
  sum_rate = 'sum_rate',
  sum = 'sum',
}

const AggFnV1Schema = z.nativeEnum(AggFnV1);

export type SourceTableV1 = 'logs' | 'rrweb' | 'metrics';

type SeriesDBDataSourceV1 = {
  databaseName?: string;
  tableName?: string;
  timestampColumn?: string;
};

export type TimeChartSeriesV1 = {
  displayName?: string;
  table: SourceTableV1;
  type: 'time';
  aggFn?: AggFnV1;
  field?: string | undefined;
  where: string;
  groupBy: string[];
  numberFormat?: NumberFormat;
  color?: string;
  displayType?: 'stacked_bar' | 'line';
  implicitColumn?: string;
  whereSql?: string;
  groupBySql?: string;
  fieldSql?: string;
} & SeriesDBDataSourceV1;

export type TableChartSeriesV1 = {
  visible?: boolean;
  columnWidthPercent?: number;
  displayName?: string;
  type: 'table';
  table: SourceTableV1;
  aggFn?: AggFnV1;
  field?: string | undefined;
  where: string;
  groupBy: string[];
  sortOrder?: 'desc' | 'asc';
  numberFormat?: NumberFormat;
  color?: string;
} & SeriesDBDataSourceV1;

export type ChartSeriesV1 =
  | TimeChartSeriesV1
  | TableChartSeriesV1
  | ({
      table: SourceTableV1;
      type: 'histogram';
      field: string | undefined;
      where: string;
    } & SeriesDBDataSourceV1)
  | ({
      type: 'search';
      fields: string[];
      where: string;
    } & SeriesDBDataSourceV1)
  | ({
      type: 'number';
      table: SourceTableV1;
      aggFn: AggFnV1;
      field: string | undefined;
      where: string;
      numberFormat?: NumberFormat;
      color?: string;
    } & SeriesDBDataSourceV1)
  | {
      type: 'markdown';
      content: string;
    };

export type ChartV1 = {
  id: string;
  name: string;
  x: number;
  y: number;
  w: number;
  h: number;
  series: ChartSeriesV1[];
  seriesReturnType: 'ratio' | 'column';
};

export enum MetricsDataTypeV1 {
  Gauge = 'Gauge',
  Histogram = 'Histogram',
  Sum = 'Sum',
  Summary = 'Summary',
}

// Define a mapping from app AggFn to common-utils AggregateFunction
export const mapV1AggFnToV2 = (
  aggFn?: AggFnV1,
): AggregateFunction | undefined => {
  if (aggFn == null) {
    return aggFn;
  }

  // Map rate-based aggregations to their base aggregation
  if (aggFn.endsWith('_rate')) {
    const prefix = aggFn.replace('_rate', '');
    const parsed = AggFnV1Schema.safeParse(prefix);
    if (parsed.success) {
      return mapV1AggFnToV2(parsed.data);
    }
  }

  // Map percentiles to quantile
  if (
    aggFn === 'p50' ||
    aggFn === 'p90' ||
    aggFn === 'p95' ||
    aggFn === 'p99'
  ) {
    return 'quantile';
  }

  // Map per-time-unit counts to count
  if (
    aggFn === 'count_per_sec' ||
    aggFn === 'count_per_min' ||
    aggFn === 'count_per_hour'
  ) {
    return 'count';
  }

  // For standard aggregations that exist in both, return as is
  if (AggregateFunctionSchema.safeParse(aggFn).success) {
    return AggregateFunctionSchema.parse(aggFn);
  }

  throw new Error(`Unsupported aggregation function in v2: ${aggFn}`);
};

export const convertV1GroupByToV2 = (
  metricSource: TSource,
  groupBy: string[],
): string => {
  return groupBy
    .map(g => {
      if (g.startsWith('k8s')) {
        return `${metricSource.resourceAttributesExpression}['${g}']`;
      }
      return g;
    })
    .join(',');
};

export const convertV1ChartConfigToV2 = (
  chartConfig: {
    // only support time or table series
    series: (TimeChartSeriesV1 | TableChartSeriesV1)[];
    granularity?: Granularity;
    dateRange: [Date, Date];
    seriesReturnType: 'ratio' | 'column';
    displayType?: 'stacked_bar' | 'line';
    name?: string;
    fillNulls?: number | false;
    sortOrder?: 'desc' | 'asc';
  },
  source: {
    log?: TSource;
    metric?: TSource;
    trace?: TSource;
  },
): ChartConfigWithDateRange => {
  const {
    series,
    granularity,
    dateRange,
    displayType = 'line',
    fillNulls,
  } = chartConfig;

  if (series.length < 1) {
    throw new Error('series is required');
  }

  const firstSeries = series[0];
  const convertedDisplayType =
    displayType === 'stacked_bar' ? DisplayType.StackedBar : DisplayType.Line;

  if (firstSeries.table === 'logs') {
    // TODO: this might not work properly since logs + traces are mixed in v1
    throw new Error('IMPLEMENT ME (logs)');
  } else if (firstSeries.table === 'metrics') {
    if (source.metric == null) {
      throw new Error('source.metric is required for metrics');
    }
    return {
      select: series.map(s => {
        const field = s.field ?? '';
        const [metricName, rawMetricDataType] = field
          .split(' - ')
          .map(s => s.trim());

        // Check if this metric name needs version-based SQL transformation
        const metricNameSql = getMetricNameSql(metricName);

        const metricDataType = z
          .nativeEnum(MetricsDataType)
          .parse(rawMetricDataType?.toLowerCase());
        return {
          aggFn: mapV1AggFnToV2(s.aggFn),
          metricType: metricDataType,
          valueExpression: field,
          metricName,
          metricNameSql,
          aggConditionLanguage: 'lucene',
          aggCondition: s.where,
        };
      }),
      from: source.metric?.from,
      numberFormat: firstSeries.numberFormat,
      groupBy: convertV1GroupByToV2(source.metric, firstSeries.groupBy),
      dateRange,
      connection: source.metric?.connection,
      metricTables: source.metric?.metricTables,
      timestampValueExpression: source.metric?.timestampValueExpression,
      granularity,
      where: '',
      fillNulls,
      displayType: convertedDisplayType,
    };
  }
  throw new Error(`unsupported table in v2: ${firstSeries.table}`);
};
