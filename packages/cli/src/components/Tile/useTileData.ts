/**
 * React hook wrapping fetchTileData for the interactive TUI.
 *
 * Mirrors the web's useQueriedChartConfig usage in dashboard tiles
 * (minus react-query caching / chunking / MV optimization).
 */

import { useEffect, useRef, useState } from 'react';

import type { Metadata } from '@hyperdx/common-utils/dist/core/metadata';
import type { SavedChartConfig } from '@hyperdx/common-utils/dist/types';

import type { ProxyClickhouseClient, SourceResponse } from '@/api/client';
import { fetchTileData, type TileQueryResult } from '@/shared/tileQuery';

export interface UseTileDataParams {
  clickhouseClient: ProxyClickhouseClient;
  metadata: Metadata;
  config: SavedChartConfig;
  source: SourceResponse | undefined;
  dateRange: [Date, Date];
  granularity?: string;
  maxTimeBuckets?: number;
  /** Gate fetching (e.g. offscreen tiles) */
  enabled?: boolean;
  /** Bump to force a refetch */
  refreshKey?: number;
}

export interface UseTileDataReturn {
  result: TileQueryResult | null;
  loading: boolean;
  error: Error | null;
}

export function useTileData({
  clickhouseClient,
  metadata,
  config,
  source,
  dateRange,
  granularity,
  maxTimeBuckets,
  enabled = true,
  refreshKey = 0,
}: UseTileDataParams): UseTileDataReturn {
  const [result, setResult] = useState<TileQueryResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  // Stable scalar deps to avoid refetch loops from new array identities
  const dateRangeKey = `${dateRange[0].getTime()}-${dateRange[1].getTime()}`;
  const configRef = useRef(config);
  configRef.current = config;
  const sourceRef = useRef(source);
  sourceRef.current = source;

  useEffect(() => {
    if (!enabled) return;

    const controller = new AbortController();
    let cancelled = false;

    (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetchTileData({
          clickhouseClient,
          metadata,
          config: configRef.current,
          source: sourceRef.current,
          dateRange: [
            new Date(Number(dateRangeKey.split('-')[0])),
            new Date(Number(dateRangeKey.split('-')[1])),
          ],
          granularity,
          maxTimeBuckets,
          signal: controller.signal,
        });
        if (!cancelled) {
          setResult(res);
        }
      } catch (err) {
        if (!cancelled && !controller.signal.aborted) {
          setError(err instanceof Error ? err : new Error(String(err)));
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [
    clickhouseClient,
    metadata,
    dateRangeKey,
    granularity,
    maxTimeBuckets,
    enabled,
    refreshKey,
  ]);

  return { result, loading, error };
}
