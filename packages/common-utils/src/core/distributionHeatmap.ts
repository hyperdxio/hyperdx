import type { BaseClickhouseClient } from '@/clickhouse';
import { inferTimestampColumn } from '@/clickhouse';
import type { HeatmapGrid, HeatmapScaleType } from '@/core/heatmap';
import {
  computeEffectiveMin,
  gridFromBucketRows,
  heatmapBucketEdges,
  resolveDistributionGranularity,
} from '@/core/heatmap';
import {
  buildHeatmapBoundsConfig,
  buildHeatmapBucketConfig,
  toDistributionHeatmapConfig,
} from '@/core/heatmapQuery';
import type { Metadata } from '@/core/metadata';
import { timeBucketByGranularity } from '@/core/utils';
import type {
  BuilderChartConfigWithDateRange,
  QuerySettings,
  SQLInterval,
} from '@/types';

/**
 * Runs a distribution heatmap outside the browser: the bounds query, then the
 * `widthBucket` query, shaped into a grid. `heatmap` is absent when the range
 * holds too few distinct values to bucket.
 */
export async function queryDistributionHeatmap({
  client,
  metadata,
  config,
  granularity: requestedGranularity,
  targetTimeBuckets,
  nBuckets,
  querySettings,
  opts,
}: {
  client: Pick<BaseClickhouseClient, 'queryChartConfig'>;
  metadata: Metadata;
  config: BuilderChartConfigWithDateRange;
  granularity: string | undefined;
  targetTimeBuckets: number;
  nBuckets: number;
  querySettings: QuerySettings | undefined;
  opts?: Parameters<BaseClickhouseClient['queryChartConfig']>[0]['opts'];
}): Promise<{
  granularity: SQLInterval;
  granularityNote?: string;
  heatmap?: {
    grid: HeatmapGrid;
    scaleType: HeatmapScaleType;
    bucketEdges: number[];
  };
}> {
  const { granularity, note: granularityNote } = resolveDistributionGranularity(
    requestedGranularity,
    config.dateRange,
    targetTimeBuckets,
  );
  const { config: heatmapConfig, scaleType } =
    toDistributionHeatmapConfig(config);

  const bounds = await client.queryChartConfig({
    config: buildHeatmapBoundsConfig({
      config: heatmapConfig,
      scaleType,
      granularity,
    }),
    metadata,
    querySettings,
    opts,
  });
  // quantile returns floats; UInt64 come back as strings
  const min = Number.parseFloat(String(bounds.data?.[0]?.['min'] ?? '0'));
  const max = Number.parseFloat(String(bounds.data?.[0]?.['max'] ?? '0'));
  const effectiveMin = computeEffectiveMin(min, max, scaleType);
  if (!(max > effectiveMin)) return { granularity, granularityNote };

  const buckets = await client.queryChartConfig({
    config: buildHeatmapBucketConfig({
      config: heatmapConfig,
      scaleType,
      effectiveMin,
      max,
      granularity,
      nBuckets,
    }),
    metadata,
    querySettings,
    opts,
  });
  const timestampColumn = inferTimestampColumn(buckets.meta ?? []);
  if (timestampColumn == null) {
    throw new Error('Heatmap bucket query returned no time bucket column');
  }

  const [start, end] = config.dateRange;
  return {
    granularity,
    granularityNote,
    heatmap: {
      grid: gridFromBucketRows({
        data: buckets.data,
        timestampColumn,
        generatedTsBuckets: timeBucketByGranularity(start, end, granularity),
        scaleType,
        effectiveMin,
        max,
        nBuckets,
      }),
      scaleType,
      bucketEdges: heatmapBucketEdges(scaleType, effectiveMin, max, nBuckets),
    },
  };
}
