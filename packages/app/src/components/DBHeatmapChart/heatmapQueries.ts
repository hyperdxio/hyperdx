import type { HeatmapScaleType } from '@hyperdx/common-utils/dist/core/heatmap';
import { getHeatmapMode } from '@hyperdx/common-utils/dist/core/heatmap';
import {
  type HeatmapChartConfig,
  toDistributionHeatmapConfig,
} from '@hyperdx/common-utils/dist/core/heatmapQuery';
import { getAlignedDateRange } from '@hyperdx/common-utils/dist/core/utils';
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

/** Linear, since PromQL samples often include zeros, which log scale drops. */
export const PROMQL_DEFAULT_HEATMAP_SCALE_TYPE: HeatmapScaleType = 'linear';

/**
 * What a heatmap queries, by mode. Distribution heatmaps bucket a value
 * expression server-side; calculated heatmaps bucket the samples of a PromQL
 * range query client-side; histogram heatmaps draw the `le` buckets of a
 * PromQL histogram; series heatmaps query one builder series or PromQL
 * expression per time bucket and draw a row per series.
 */
export type HeatmapQuery =
  | {
      mode: 'distribution';
      config: HeatmapChartConfig;
      scaleType: HeatmapScaleType;
    }
  | {
      mode: 'calculated';
      config: PromqlConfigWithDateRange;
      scaleType: HeatmapScaleType;
    }
  | {
      mode: 'histogram';
      config: PromqlConfigWithDateRange;
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

export function toHeatmapQuery(config: HeatmapSeriesChartConfig): HeatmapQuery {
  const mode = getHeatmapMode(config);
  if (mode === 'series') {
    return { mode: 'series', config };
  }

  if (isPromqlChartConfig(config)) {
    if (mode === 'histogram') {
      return { mode: 'histogram', config };
    }
    return {
      mode: 'calculated',
      config,
      scaleType: config.heatmap?.scaleType ?? PROMQL_DEFAULT_HEATMAP_SCALE_TYPE,
    };
  }

  return { mode: 'distribution', ...toDistributionHeatmapConfig(config) };
}

/**
 * The time-chart query behind a series-mode, calculated or histogram heatmap,
 * bucketed at the heatmap's granularity: `select[0]` and the group by for a
 * builder config, or the first expression's range query for PromQL.
 */
export function buildHeatmapSeriesConfig(
  config: HeatmapSeriesChartConfig,
  granularity: SQLInterval,
): ChartConfigWithDateRange {
  // Heatmaps have no series limit control, a default is applied automatically.
  // Heatmap settings only change how the response is drawn, so keep them out
  // of the query's cache key: switching mode or scale reuses the data.
  // Histogram mode is the exception, since its response is keyed by bucket.
  if (isPromqlChartConfig(config)) {
    return convertToTimeChartConfig({
      ...config,
      granularity,
      seriesLimit: undefined,
      heatmap:
        config.heatmap?.mode === 'histogram'
          ? { mode: 'histogram' }
          : undefined,
    });
  }
  return convertToTimeChartConfig({
    ...config,
    ...(Array.isArray(config.select)
      ? { select: config.select.slice(0, 1) }
      : {}),
    granularity,
    seriesLimit: undefined,
    heatmap: undefined,
  });
}
