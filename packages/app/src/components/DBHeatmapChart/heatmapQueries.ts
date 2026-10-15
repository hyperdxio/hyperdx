import type { HeatmapScaleType } from '@hyperdx/common-utils/dist/core/heatmap';
import { getHeatmapMode } from '@hyperdx/common-utils/dist/core/heatmap';
import {
  type HeatmapChartConfig,
  toDistributionHeatmapConfig,
} from '@hyperdx/common-utils/dist/core/heatmapQuery';
import {
  isBuilderChartConfig,
  isPromqlChartConfig,
} from '@hyperdx/common-utils/dist/guards';
import {
  BuilderChartConfigWithDateRange,
  ChartConfigWithDateRange,
  PromqlConfigWithDateRange,
  SQLInterval,
} from '@hyperdx/common-utils/dist/types';

import {
  convertToTimeChartConfig,
  getTimeChartGranularity,
} from '@/ChartUtils';

export {
  buildHeatmapBoundsConfig,
  buildHeatmapBucketConfig,
  type HeatmapChartConfig,
} from '@hyperdx/common-utils/dist/core/heatmapQuery';

/** The configs a series-mode heatmap can query. */
export type HeatmapSeriesChartConfig =
  | BuilderChartConfigWithDateRange
  | PromqlConfigWithDateRange;

/**
 * What a heatmap queries, by mode. Distribution heatmaps bucket a value
 * expression server-side; series heatmaps query one builder series or PromQL
 * expression per time bucket and draw a row per series.
 */
export type HeatmapQuery =
  | {
      mode: 'distribution';
      config: HeatmapChartConfig;
      scaleType: HeatmapScaleType;
    }
  | {
      mode: 'series';
      config: HeatmapSeriesChartConfig;
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
  return getTimeChartGranularity(
    granularity,
    dateRange,
    minGranularitySeconds,
    HEATMAP_AUTO_GRANULARITY_BUCKETS,
  );
}

/** PromQL heatmaps only support series mode. */
export function toHeatmapQuery(config: HeatmapSeriesChartConfig): HeatmapQuery {
  if (isPromqlChartConfig(config) || getHeatmapMode(config) === 'series') {
    return { mode: 'series', config };
  }

  return { mode: 'distribution', ...toDistributionHeatmapConfig(config) };
}

/**
 * The time-chart query behind a series-mode heatmap, bucketed at the heatmap's
 * granularity: `select[0]` and the group by for a builder config, or the first
 * expression's range query for PromQL.
 */
export function buildHeatmapSeriesConfig(
  config: HeatmapSeriesChartConfig,
  granularity: SQLInterval,
): ChartConfigWithDateRange {
  return convertToTimeChartConfig({
    ...config,
    ...(isBuilderChartConfig(config) && Array.isArray(config.select)
      ? { select: config.select.slice(0, 1) }
      : {}),
    granularity,
    // Heatmaps have no series limit control, a default is applied automatically
    seriesLimit: undefined,
  });
}
