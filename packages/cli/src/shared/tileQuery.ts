/**
 * Tile data fetching — resolves a saved tile config against its source
 * and executes it through `queryChartConfig` (common-utils), which
 * renders SQL via `renderChartConfig` exactly like the web frontend.
 */

import type { ResponseJSON } from '@hyperdx/common-utils/dist/clickhouse';
import {
  getHeatmapMode,
  type HeatmapGrid,
  type HeatmapResult,
  heatmapRowEdges,
  toHeatmapResult,
} from '@hyperdx/common-utils/dist/core/heatmap';
import { queryDistributionHeatmap } from '@hyperdx/common-utils/dist/core/distributionHeatmap';
import type { Metadata } from '@hyperdx/common-utils/dist/core/metadata';
import {
  isBuilderChartConfig,
  isHeatmapCompatibleSource,
} from '@hyperdx/common-utils/dist/guards';
import type {
  ChartConfigWithDateRange,
  SavedChartConfig,
} from '@hyperdx/common-utils/dist/types';
import { DisplayType, SourceKind } from '@hyperdx/common-utils/dist/types';

import type { ProxyClickhouseClient, SourceResponse } from '@/api/client';
import { heatmapNumberFormat } from '@/shared/formatNumber';
import {
  CLI_SUPPORTED_DISPLAY_TYPES,
  convertTileConfigForQuery,
  resolveTileConfig,
  type ResolvedTileConfig,
} from '@/shared/tileConfig';

export type TileQueryResult =
  | {
      status: 'ok';
      /** Resolved + displayType-converted config that was queried */
      queriedConfig: ChartConfigWithDateRange;
      data: ResponseJSON<Record<string, string | number>>;
    }
  | {
      status: 'heatmap';
      queriedConfig: ChartConfigWithDateRange;
      /** Undefined when the range has too few distinct values to bucket */
      grid: HeatmapGrid | undefined;
      /** The same grid in the shape the MCP server returns, for --json */
      heatmap?: HeatmapResult;
    }
  | {
      status: 'markdown';
      /** Markdown tiles render statically without querying */
      markdown: string;
    }
  | { status: 'unsupported'; message: string }
  | {
      status: 'unresolved';
      resolution: Extract<ResolvedTileConfig, { ok: false }>;
    };

// Value buckets per heatmap column; the renderer merges them to fit its rows.
const HEATMAP_VALUE_BUCKETS = 40;

export interface FetchTileDataParams {
  clickhouseClient: ProxyClickhouseClient;
  metadata: Metadata;
  config: SavedChartConfig;
  source: SourceResponse | undefined;
  dateRange: [Date, Date];
  granularity?: string;
  /** Target time-bucket count for auto granularity (web uses 80) */
  maxTimeBuckets?: number;
  signal?: AbortSignal;
}

export async function fetchTileData({
  clickhouseClient,
  metadata,
  config,
  source,
  dateRange,
  granularity,
  maxTimeBuckets = 80,
  signal,
}: FetchTileDataParams): Promise<TileQueryResult> {
  const displayType = config.displayType ?? DisplayType.Line;

  if (displayType === DisplayType.Markdown) {
    return {
      status: 'markdown',
      markdown:
        ('markdown' in config ? (config.markdown ?? '') : '') || '(empty)',
    };
  }

  if (!CLI_SUPPORTED_DISPLAY_TYPES.has(displayType)) {
    return {
      status: 'unsupported',
      message: `"${displayType}" tiles are not supported in the CLI yet.`,
    };
  }

  const resolution = resolveTileConfig({
    config,
    source,
    dateRange,
    granularity,
  });

  if (!resolution.ok) {
    if (resolution.reason === 'promql-unsupported') {
      return { status: 'unsupported', message: resolution.message };
    }
    return { status: 'unresolved', resolution };
  }

  if (displayType === DisplayType.Heatmap) {
    const heatmapConfig = resolution.config;
    if (
      !isBuilderChartConfig(heatmapConfig) ||
      getHeatmapMode(heatmapConfig) === 'series'
    ) {
      return {
        status: 'unsupported',
        message: 'Series heatmap tiles are not supported in the CLI yet.',
      };
    }
    // The CLI's source kind is a string; map it onto SourceKind for the shared guard.
    const sourceKind = Object.values(SourceKind).find(k => k === source?.kind);
    if (
      source &&
      !(sourceKind && isHeatmapCompatibleSource({ kind: sourceKind }))
    ) {
      return {
        status: 'unsupported',
        message: `Distribution heatmaps need a trace source; "${source.name}" is a ${source.kind} source.`,
      };
    }
    const result = await queryDistributionHeatmap({
      client: clickhouseClient,
      metadata,
      config: heatmapConfig,
      // resolveTileConfig swaps in the command's granularity, which is unset
      // by default; fall back to the tile's own.
      granularity:
        granularity ??
        ('granularity' in config ? config.granularity : undefined),
      targetTimeBuckets: maxTimeBuckets,
      nBuckets: HEATMAP_VALUE_BUCKETS,
      querySettings: source?.querySettings,
      opts: { abort_signal: signal },
    });
    const { heatmap } = result;
    const firstSelect = Array.isArray(heatmapConfig.select)
      ? heatmapConfig.select[0]
      : undefined;
    return {
      status: 'heatmap',
      queriedConfig: heatmapConfig,
      // Label rows with the bucket bounds widthBucket counted, not the
      // web's centred display edges.
      grid: heatmap && {
        ...heatmap.grid,
        yAxis: {
          type: 'numeric',
          scale: heatmap.scaleType,
          edges: heatmapRowEdges(heatmap.bucketEdges, heatmap.scaleType),
        },
      },
      heatmap:
        heatmap &&
        toHeatmapResult(heatmap, {
          valueExpression: firstSelect?.valueExpression ?? '',
          granularity: result.granularity,
          numberFormat: heatmapNumberFormat(heatmapConfig, source),
        }),
    };
  }

  const queriedConfig = convertTileConfigForQuery(resolution.config, {
    maxTimeBuckets,
  });

  // Same call the web frontend's useQueriedChartConfig makes —
  // internally: setChartSelectsAlias → renderChartConfig → query (one
  // composed statement, even for multi-series metric charts).
  const data = await clickhouseClient.queryChartConfig({
    config: queriedConfig,
    metadata,
    opts: {
      abort_signal: signal,
    },
    querySettings: source?.querySettings,
  });

  return { status: 'ok', queriedConfig, data };
}
