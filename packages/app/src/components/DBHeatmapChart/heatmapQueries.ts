import { getHeatmapMode } from '@hyperdx/common-utils/dist/core/heatmap';
import { convertDateRangeToGranularityString } from '@hyperdx/common-utils/dist/core/utils';
import {
  BuilderChartConfigWithDateRange,
  ChartConfigWithDateRange,
  DisplayType,
  SQLInterval,
} from '@hyperdx/common-utils/dist/types';

import { convertToTimeChartConfig, isAggregateFunction } from '@/ChartUtils';

import { heatmapLowQuantile } from './heatmapBounds';
import type { HeatmapScaleType } from './heatmapGrid';

export type HeatmapChartConfig = {
  displayType: DisplayType.Heatmap;
  select: [
    {
      aggFn: 'heatmap';
      valueExpression: string;
      countExpression?: string;
    },
  ];
  from: BuilderChartConfigWithDateRange['from'];
  where: BuilderChartConfigWithDateRange['where'];
  dateRange: BuilderChartConfigWithDateRange['dateRange'];
  granularity: BuilderChartConfigWithDateRange['granularity'];
  timestampValueExpression: BuilderChartConfigWithDateRange['timestampValueExpression'];
  numberFormat?: BuilderChartConfigWithDateRange['numberFormat'];
  filters?: BuilderChartConfigWithDateRange['filters'];
  connection: string;
  with?: BuilderChartConfigWithDateRange['with'];
};

/**
 * What a heatmap queries, by mode. Distribution heatmaps bucket a value
 * expression server-side; series heatmaps query one builder series per time
 * bucket and draw a row per series.
 */
export type HeatmapQuery =
  | {
      mode: 'distribution';
      config: HeatmapChartConfig;
      scaleType: HeatmapScaleType;
    }
  | {
      mode: 'series';
      config: BuilderChartConfigWithDateRange;
    };

const HEATMAP_AUTO_GRANULARITY_BUCKETS = 245;

/**
 * `minGranularitySeconds` floors only auto granularity: an explicit
 * granularity is the user's choice and is kept as-is.
 */
export function resolveHeatmapGranularity({
  granularity,
  dateRange,
  minGranularitySeconds,
}: Pick<
  BuilderChartConfigWithDateRange,
  'granularity' | 'dateRange' | 'minGranularitySeconds'
>): SQLInterval {
  return granularity == null || granularity === 'auto'
    ? convertDateRangeToGranularityString(
        dateRange,
        HEATMAP_AUTO_GRANULARITY_BUCKETS,
        minGranularitySeconds,
      )
    : granularity;
}

export function toHeatmapQuery(
  config: BuilderChartConfigWithDateRange,
): HeatmapQuery {
  if (getHeatmapMode(config) === 'series') {
    return { mode: 'series', config };
  }

  const firstSelect = Array.isArray(config.select)
    ? config.select[0]
    : undefined;
  return {
    mode: 'distribution',
    config: {
      ...config,
      displayType: DisplayType.Heatmap,
      select: [
        {
          aggFn: 'heatmap' as const,
          valueExpression: firstSelect?.valueExpression ?? '',
          countExpression: firstSelect?.countExpression,
        },
      ],
      granularity: config.granularity,
      numberFormat: config.numberFormat,
    },
    scaleType: firstSelect?.heatmapScaleType ?? 'log',
  };
}

/**
 * The time-chart query behind a series-mode heatmap: `select[0]` and the
 * group by, bucketed at the heatmap's granularity.
 */
export function buildHeatmapSeriesConfig(
  config: BuilderChartConfigWithDateRange,
  granularity: SQLInterval,
): ChartConfigWithDateRange {
  return convertToTimeChartConfig({
    ...config,
    select: Array.isArray(config.select)
      ? config.select.slice(0, 1)
      : config.select,
    granularity,
    // Heatmaps have no series limit control, a default is applied automatically
    seriesLimit: undefined,
  });
}

/**
 * Build the bounds (min/max) ChartConfig that runs first.  Result feeds
 * `effectiveMin`/`max` into `buildHeatmapBucketConfig`.
 */
export function buildHeatmapBoundsConfig({
  config,
  scaleType,
}: {
  config: HeatmapChartConfig;
  scaleType: HeatmapScaleType;
}): BuilderChartConfigWithDateRange {
  const valueExpression = config.select[0].valueExpression;
  const isAggregateExpression = isAggregateFunction(valueExpression);
  const qLo = heatmapLowQuantile(scaleType);

  return isAggregateExpression
    ? {
        ...config,
        where: '',
        orderBy: undefined,
        granularity: undefined,
        select: [
          {
            aggFn: 'quantile' as const,
            level: qLo,
            aggCondition: `value_calc >= 0`,
            aggConditionLanguage: 'sql',
            valueExpression: 'value_calc',
            alias: 'min',
          },
          {
            aggFn: 'max' as const,
            valueExpression: 'value_calc',
            alias: 'max',
          },
        ],
        with: [
          {
            name: 'min_max_calc',
            chartConfig: {
              ...config,
              select: [{ valueExpression, alias: 'value_calc' }],
              orderBy: undefined,
            },
          },
        ],
        timestampValueExpression: '__hdx_time_bucket',
        from: { databaseName: '', tableName: 'min_max_calc' },
      }
    : {
        ...config,
        orderBy: undefined,
        granularity: undefined,
        select: [
          {
            aggFn: 'quantile' as const,
            level: qLo,
            valueExpression,
            aggCondition: `${valueExpression} >= 0`,
            aggConditionLanguage: 'sql',
            alias: 'min',
          },
          {
            aggFn: 'max' as const,
            valueExpression,
            alias: 'max',
          },
        ],
      };
}

/**
 * Build the bucketed-counts ChartConfig that runs second.  `effectiveMin`/`max`
 * are usually numbers (resolved from the bounds query), but accept strings so
 * callers — like the editor's SQL preview — can pass placeholder tokens
 * (e.g. `'{min}'`) before the bounds are known.
 */
export function buildHeatmapBucketConfig({
  config,
  scaleType,
  effectiveMin,
  max,
  granularity,
  nBuckets,
}: {
  config: HeatmapChartConfig;
  scaleType: HeatmapScaleType;
  effectiveMin: string | number;
  max: string | number;
  granularity: string;
  nBuckets: number;
}): BuilderChartConfigWithDateRange {
  const valueExpression = config.select[0].valueExpression;
  // The chart editor saves a cleared Count input as ''.
  const countExpression = config.select[0].countExpression?.trim() || 'count()';
  const isAggregateExpression = isAggregateFunction(valueExpression);

  const bucketExprAgg =
    scaleType === 'log'
      ? `widthBucket(log(greatest(toFloat64(value_calc), ${effectiveMin})), log(${effectiveMin}), log(${max}), ${nBuckets})`
      : `widthBucket(value_calc, ${effectiveMin}, ${max}, ${nBuckets})`;
  const bucketExprDirect =
    scaleType === 'log'
      ? `widthBucket(log(greatest(toFloat64(${valueExpression}), ${effectiveMin})), log(${effectiveMin}), log(${max}), ${nBuckets})`
      : `widthBucket(${valueExpression}, ${effectiveMin}, ${max}, ${nBuckets})`;

  return isAggregateExpression
    ? {
        ...config,
        where: '',
        select: [
          {
            valueExpression: 'sum(value_count)',
            alias: 'count',
          },
        ],
        groupBy: [
          {
            valueExpression: bucketExprAgg,
            alias: 'x_bucket',
          },
        ],
        with: [
          {
            name: 'bucket_calc',
            chartConfig: {
              ...config,
              select: [
                { valueExpression, alias: 'value_calc' },
                {
                  valueExpression: countExpression,
                  alias: 'value_count',
                },
              ],
              granularity,
              orderBy: undefined,
            },
          },
        ],
        timestampValueExpression: '__hdx_time_bucket',
        from: { databaseName: '', tableName: 'bucket_calc' },
        orderBy: [{ valueExpression: 'x_bucket', ordering: 'ASC' }],
        granularity,
      }
    : {
        ...config,
        select: [
          {
            valueExpression: countExpression,
            alias: 'count',
          },
        ],
        groupBy: [
          {
            valueExpression: bucketExprDirect,
            alias: 'x_bucket',
          },
        ],
        orderBy: [{ valueExpression: 'x_bucket', ordering: 'ASC' }],
        granularity,
      };
}
