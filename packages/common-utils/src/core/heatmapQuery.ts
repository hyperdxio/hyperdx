import type { HeatmapScaleType } from '@/core/heatmap';
import { heatmapLowQuantile } from '@/core/heatmap';
import { getAlignedDateRange, isAggregateFunction } from '@/core/utils';
import type { BuilderChartConfigWithDateRange, SQLInterval } from '@/types';
import { DisplayType } from '@/types';

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
 * The query a distribution heatmap runs, from a builder config whose first
 * select item names the value to bucket.
 */
export function toDistributionHeatmapConfig(
  config: BuilderChartConfigWithDateRange,
): { config: HeatmapChartConfig; scaleType: HeatmapScaleType } {
  const firstSelect = Array.isArray(config.select)
    ? config.select[0]
    : undefined;
  return {
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
 * Build the bounds (min/max) ChartConfig that runs first.  Result feeds
 * `effectiveMin`/`max` into `buildHeatmapBucketConfig`.
 */
export function buildHeatmapBoundsConfig({
  config,
  scaleType,
  granularity,
}: {
  config: HeatmapChartConfig;
  scaleType: HeatmapScaleType;
  granularity: SQLInterval;
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
              // Emits the __hdx_time_bucket column the outer query filters on.
              granularity,
            },
          },
        ],
        timestampValueExpression: '__hdx_time_bucket',
        // The first bucket is labelled before an unaligned start, so align
        // this filter on bucket labels. The inner query keeps the original
        // range so no events outside it are counted.
        dateRange: getAlignedDateRange(config.dateRange, granularity),
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
  granularity: SQLInterval;
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
        dateRange: getAlignedDateRange(config.dateRange, granularity),
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
