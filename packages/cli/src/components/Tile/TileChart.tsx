/**
 * Dashboard tile chart — Ink wrapper around the shared tile query +
 * render pipeline.
 *
 * Mirror of the web Tile component's renderChartContent dispatch
 * (packages/app/src/DBDashboardPage.tsx): the query goes through
 * queryChartConfig/renderChartConfig, then the result is rendered per
 * display type by the shared ANSI renderers.
 */

import React from 'react';
import { Box, Text } from 'ink';
import Spinner from 'ink-spinner';

import type { Metadata } from '@hyperdx/common-utils/dist/core/metadata';
import type { Tile } from '@hyperdx/common-utils/dist/types';

import type { ProxyClickhouseClient, SourceResponse } from '@/api/client';
import { renderTileContent } from '@/shared/tileRender';

import { useTileData } from './useTileData';

export interface TileChartProps {
  clickhouseClient: ProxyClickhouseClient;
  metadata: Metadata;
  tile: Tile;
  /** All available sources — the tile's source is resolved by ID */
  sources: SourceResponse[];
  dateRange: [Date, Date];
  granularity?: string;
  /** Content area dimensions (excluding any parent border/title) */
  width: number;
  height: number;
  enabled?: boolean;
  refreshKey?: number;
}

function findTileSource(
  sources: SourceResponse[],
  sourceId: string | undefined,
): SourceResponse | undefined {
  if (!sourceId) return undefined;
  return sources.find(s => s.id === sourceId || s._id === sourceId);
}

export default function TileChart({
  clickhouseClient,
  metadata,
  tile,
  sources,
  dateRange,
  granularity,
  width,
  height,
  enabled = true,
  refreshKey,
}: TileChartProps) {
  const sourceId = 'source' in tile.config ? tile.config.source : undefined;
  const source = findTileSource(sources, sourceId);

  const maxTimeBuckets = Math.max(20, Math.min(80, width - 14));

  const { result, loading, error } = useTileData({
    clickhouseClient,
    metadata,
    config: tile.config,
    source,
    dateRange,
    granularity,
    maxTimeBuckets,
    enabled,
    refreshKey,
  });

  if (error) {
    return (
      <Box width={width} height={height} overflow="hidden">
        <Text color="red" wrap="truncate-end">
          Error: {error.message}
        </Text>
      </Box>
    );
  }

  if (loading && !result) {
    return (
      <Box width={width} height={height}>
        <Text dimColor>
          <Spinner type="dots" /> Loading chart data…
        </Text>
      </Box>
    );
  }

  if (!result) {
    return <Box width={width} height={height} />;
  }

  // Shaping/rendering can throw on non-conforming results (e.g. a raw-SQL
  // line tile whose rows lack a Date or numeric column). Degrade to a
  // per-tile error instead of crashing the whole Ink TUI — mirrors the
  // try/catch around the same call in the `hdx chart` command.
  let content: string;
  try {
    content = renderTileContent({ result, source, width, height });
  } catch (err) {
    return (
      <Box width={width} height={height} overflow="hidden">
        <Text color="red" wrap="truncate-end">
          Render failed: {err instanceof Error ? err.message : String(err)}
        </Text>
      </Box>
    );
  }

  return (
    <Box width={width} height={height} overflow="hidden" flexDirection="column">
      <Text>{content}</Text>
    </Box>
  );
}
