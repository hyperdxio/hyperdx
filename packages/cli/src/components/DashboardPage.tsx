/**
 * Dashboards page — dashboard picker + tile chart view.
 *
 * Tiles are rendered top-to-bottom in grid order (sorted by y, then x)
 * and query ClickHouse through the same renderChartConfig pipeline as
 * the web dashboard (see shared/tileQuery.ts). Only tiles scrolled
 * into view are mounted, mirroring the web's viewport-gated fetching.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Box, Text, useInput, useStdout } from 'ink';
import Spinner from 'ink-spinner';

import type { Tile } from '@hyperdx/common-utils/dist/types';

import type {
  ApiClient,
  DashboardResponse,
  ProxyClickhouseClient,
  SourceResponse,
} from '@/api/client';
import TileChart from '@/components/Tile/TileChart';
import { sortTilesForDisplay } from '@/shared/tileConfig';
import { openEditorForTimeRange, type TimeRange } from '@/utils/editor';

// ---- Helpers ---------------------------------------------------------

/** Map a tile's grid height (RGL units) to terminal rows. */
function tileContentHeight(tile: Tile): number {
  return Math.max(6, Math.min(18, Math.round(tile.h * 2)));
}

function tileTitle(tile: Tile): string {
  return tile.config.name || '(untitled)';
}

function defaultTimeRange(): TimeRange {
  const end = new Date();
  return { start: new Date(end.getTime() - 60 * 60 * 1000), end };
}

function formatTimeRange(range: TimeRange): string {
  const fmt = (d: Date) =>
    d
      .toISOString()
      .replace('T', ' ')
      .replace(/\.\d+Z$/, 'Z');
  return `${fmt(range.start)} → ${fmt(range.end)}`;
}

// ---- Component -------------------------------------------------------

interface DashboardPageProps {
  client: ApiClient;
  clickhouseClient: ProxyClickhouseClient;
  metadata: ReturnType<ApiClient['createMetadata']>;
  sources: SourceResponse[];
  onClose: () => void;
}

export default function DashboardPage({
  client,
  clickhouseClient,
  metadata,
  sources,
  onClose,
}: DashboardPageProps) {
  const { stdout } = useStdout();
  const termWidth = stdout?.columns ?? 80;
  const termHeight = stdout?.rows ?? 24;

  const [dashboards, setDashboards] = useState<DashboardResponse[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [pickerIdx, setPickerIdx] = useState(0);
  const [dashboard, setDashboard] = useState<DashboardResponse | null>(null);

  const [tileIdx, setTileIdx] = useState(0);
  const [scrollOffset, setScrollOffset] = useState(0);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [timeRange, setTimeRange] = useState<TimeRange>(defaultTimeRange);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    (async () => {
      try {
        const data = await client.getDashboards();
        setDashboards(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setLoading(false);
      }
    })();
  }, [client]);

  const tiles = useMemo(
    () => (dashboard ? sortTilesForDisplay(dashboard.tiles) : []),
    [dashboard],
  );

  const openDashboard = useCallback((d: DashboardResponse) => {
    setDashboard(d);
    setTileIdx(0);
    setScrollOffset(0);
    setIsFullscreen(false);
  }, []);

  // Available rows for tile content: header (2) + footer (1)
  const viewportHeight = Math.max(8, termHeight - 3);

  // Determine the window of tiles to render, greedily filling the
  // viewport with each tile's box height (content + 2 border rows).
  const visibleTiles = useMemo(() => {
    const out: { tile: Tile; index: number }[] = [];
    let used = 0;
    for (let i = scrollOffset; i < tiles.length; i++) {
      const boxHeight = tileContentHeight(tiles[i]) + 2;
      if (out.length > 0 && used + boxHeight > viewportHeight) break;
      out.push({ tile: tiles[i], index: i });
      used += boxHeight;
    }
    return out;
  }, [tiles, scrollOffset, viewportHeight]);

  // Keep the selected tile visible
  useEffect(() => {
    if (tileIdx < scrollOffset) {
      setScrollOffset(tileIdx);
      return;
    }
    const lastVisible = visibleTiles[visibleTiles.length - 1]?.index ?? 0;
    if (tileIdx > lastVisible) {
      setScrollOffset(prev =>
        Math.min(tileIdx, prev + (tileIdx - lastVisible)),
      );
    }
  }, [tileIdx, scrollOffset, visibleTiles]);

  useInput((input, key) => {
    // Back / close
    if (key.escape || input === 'h' || input === 'q') {
      if (isFullscreen) {
        setIsFullscreen(false);
        return;
      }
      if (dashboard) {
        setDashboard(null);
        return;
      }
      onClose();
      return;
    }

    // Picker navigation
    if (!dashboard) {
      if (key.upArrow || input === 'k') {
        setPickerIdx(prev => Math.max(0, prev - 1));
      }
      if (key.downArrow || input === 'j') {
        setPickerIdx(prev => Math.min(dashboards.length - 1, prev + 1));
      }
      if ((key.return || input === 'l') && dashboards[pickerIdx]) {
        openDashboard(dashboards[pickerIdx]);
      }
      return;
    }

    // Tile view navigation
    if (key.upArrow || input === 'k') {
      setTileIdx(prev => Math.max(0, prev - 1));
    }
    if (key.downArrow || input === 'j') {
      setTileIdx(prev => Math.min(tiles.length - 1, prev + 1));
    }
    if (key.return || input === 'l') {
      setIsFullscreen(true);
    }
    if (input === 'r') {
      setRefreshKey(prev => prev + 1);
    }
    if (input === 't') {
      // Let Ink finish the current render cycle before handing
      // stdin/stdout to the editor
      setTimeout(() => {
        const result = openEditorForTimeRange(timeRange);
        if (result) {
          setTimeRange(result);
          setRefreshKey(prev => prev + 1);
        }
      }, 50);
    }
  });

  const dateRange = useMemo<[Date, Date]>(
    () => [timeRange.start, timeRange.end],
    [timeRange],
  );

  // ---- Render ---------------------------------------------------------

  if (loading) {
    return (
      <Box paddingX={1}>
        <Text>
          <Spinner type="dots" /> Loading dashboards…
        </Text>
      </Box>
    );
  }

  if (error) {
    return (
      <Box flexDirection="column" paddingX={1}>
        <Text color="red">Failed to load dashboards: {error}</Text>
        <Text dimColor>Esc/q=back</Text>
      </Box>
    );
  }

  // Dashboard picker
  if (!dashboard) {
    return (
      <Box flexDirection="column" paddingX={1}>
        <Box marginBottom={1}>
          <Text color="#00c28a" bold>
            Dashboards
          </Text>
          <Text dimColor> ({dashboards.length})</Text>
        </Box>
        {dashboards.length === 0 ? (
          <Text dimColor>No dashboards found.</Text>
        ) : (
          dashboards.slice(0, Math.max(1, termHeight - 5)).map((d, i) => (
            <Box key={d.id ?? d._id}>
              <Text
                color={i === pickerIdx ? 'cyan' : undefined}
                inverse={i === pickerIdx}
              >
                {d.name}
              </Text>
              <Text dimColor>
                {'  '}
                {d.tiles.length} tile{d.tiles.length === 1 ? '' : 's'}
                {d.tags?.length ? `  [${d.tags.join(', ')}]` : ''}
              </Text>
            </Box>
          ))
        )}
        <Box marginTop={1}>
          <Text dimColor>j/k=move Enter/l=open Esc/q=back</Text>
        </Box>
      </Box>
    );
  }

  // Outer paddingX (2) + tile border (2) + tile paddingX (2)
  const contentWidth = Math.max(20, termWidth - 6);

  // Fullscreen single tile
  if (isFullscreen && tiles[tileIdx]) {
    const tile = tiles[tileIdx];
    return (
      <Box flexDirection="column" paddingX={1}>
        <Box>
          <Text bold color="#00c28a">
            {dashboard.name}
          </Text>
          <Text dimColor> › {tileTitle(tile)}</Text>
        </Box>
        <Box
          borderStyle="round"
          borderColor="cyan"
          flexDirection="column"
          paddingX={1}
        >
          <TileChart
            key={`fullscreen-${tile.id}`}
            clickhouseClient={clickhouseClient}
            metadata={metadata}
            tile={tile}
            sources={sources}
            dateRange={dateRange}
            width={contentWidth}
            height={Math.max(8, termHeight - 6)}
            refreshKey={refreshKey}
          />
        </Box>
        <Text dimColor>
          Esc/h=back t=time range r=refresh · {formatTimeRange(timeRange)}
        </Text>
      </Box>
    );
  }

  // Tile list view
  return (
    <Box flexDirection="column" paddingX={1}>
      <Box>
        <Text bold color="#00c28a">
          {dashboard.name}
        </Text>
        <Text dimColor>
          {'  '}
          {tiles.length} tile{tiles.length === 1 ? '' : 's'} ·{' '}
          {formatTimeRange(timeRange)}
        </Text>
      </Box>
      {tiles.length === 0 ? (
        <Text dimColor>This dashboard has no tiles.</Text>
      ) : (
        visibleTiles.map(({ tile, index }) => {
          const isSelected = index === tileIdx;
          const height = tileContentHeight(tile);
          return (
            <Box
              key={tile.id}
              borderStyle="round"
              borderColor={isSelected ? 'cyan' : 'gray'}
              flexDirection="column"
              paddingX={1}
            >
              <Text bold={isSelected} color={isSelected ? 'cyan' : undefined}>
                {tileTitle(tile)}{' '}
                <Text dimColor>({tile.config.displayType ?? 'chart'})</Text>
              </Text>
              <TileChart
                clickhouseClient={clickhouseClient}
                metadata={metadata}
                tile={tile}
                sources={sources}
                dateRange={dateRange}
                width={contentWidth}
                height={height - 1}
                refreshKey={refreshKey}
              />
            </Box>
          );
        })
      )}
      <Text dimColor>
        j/k=move Enter/l=fullscreen t=time range r=refresh Esc/h=back q=close
        {tiles.length > visibleTiles.length
          ? ` · ${scrollOffset + 1}-${scrollOffset + visibleTiles.length}/${tiles.length}`
          : ''}
      </Text>
    </Box>
  );
}
