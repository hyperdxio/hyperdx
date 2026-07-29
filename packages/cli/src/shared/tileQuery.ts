/**
 * Tile data fetching — resolves a saved tile config against its source
 * and executes it through `queryChartConfig` (common-utils), which
 * renders SQL via `renderChartConfig` exactly like the web frontend.
 */

import type { ResponseJSON } from '@hyperdx/common-utils/dist/clickhouse';
import type { Metadata } from '@hyperdx/common-utils/dist/core/metadata';
import type {
  ChartConfigWithDateRange,
  SavedChartConfig,
} from '@hyperdx/common-utils/dist/types';
import { DisplayType } from '@hyperdx/common-utils/dist/types';

import type { ProxyClickhouseClient, SourceResponse } from '@/api/client';
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
      status: 'markdown';
      /** Markdown tiles render statically without querying */
      markdown: string;
    }
  | { status: 'unsupported'; message: string }
  | {
      status: 'unresolved';
      resolution: Extract<ResolvedTileConfig, { ok: false }>;
    };

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

  const queriedConfig = convertTileConfigForQuery(resolution.config, {
    maxTimeBuckets,
  });

  // Same call the web frontend's useQueriedChartConfig makes —
  // internally: setChartSelectsAlias → splitChartConfigs →
  // renderChartConfig → query → join metric result sets.
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
