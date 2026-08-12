import PQueue from '@esm2cjs/p-queue';
import { z } from 'zod';

import { parseTimeRange, runConfigTile } from '@/mcp/tools/query/helpers';
import type { ToolRegistrar } from '@/mcp/tools/types';
import { mcpUserError } from '@/mcp/utils/errors';
import Dashboard from '@/models/dashboard';
import {
  convertToExternalDashboard,
  isConfigTile,
} from '@/routers/external-api/v2/utils/dashboards';
import type { ExternalDashboardTileWithId } from '@/utils/zod';
import { objectIdSchema } from '@/utils/zod';

import { getRawSqlTileMacroWarnings } from './validation';

/**
 * How many tiles to query against ClickHouse at once. Kept low so a batch
 * validation of a large dashboard doesn't hammer the connection — each tile is
 * a full chart-config query. Two in flight overlaps network/IO latency without
 * a thundering herd.
 */
const TILE_QUERY_CONCURRENCY = 2;

/** A tile whose displayType is markdown (or that has no queryable config). */
function isMarkdownTile(tile: ExternalDashboardTileWithId): boolean {
  if (!isConfigTile(tile)) return true;
  return tile.config.displayType === 'markdown';
}

/**
 * Derive a compact data summary from a successful tile query payload. The
 * payload shape is `{ result: <data>, ... }` where `<data>` is either an array
 * of rows or an object carrying a `data: [...]` array (see formatQueryResult in
 * query/helpers.ts). Anything we can't confidently read as rows is reported as
 * `hasData: undefined` rather than guessed.
 */
function summarizeRows(text: string): {
  hasData?: boolean;
  rowCount?: number;
} {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return {};
  }
  if (parsed == null || typeof parsed !== 'object' || !('result' in parsed)) {
    return {};
  }
  const result: unknown = parsed.result;
  let rows: unknown[] | undefined;
  if (Array.isArray(result)) {
    rows = result;
  } else if (
    result != null &&
    typeof result === 'object' &&
    'data' in result &&
    Array.isArray(result.data)
  ) {
    rows = result.data;
  }
  if (rows == null) return {};
  return { hasData: rows.length > 0, rowCount: rows.length };
}

type TileSummary = {
  tileId: string;
  name: string;
  displayType?: string;
  status: 'ok' | 'error' | 'skipped';
  hasData?: boolean;
  rowCount?: number;
  error?: string;
  warnings?: string[];
};

export function registerQueryTiles({
  context,
  registerTool,
}: ToolRegistrar): void {
  const { teamId } = context;

  registerTool(
    'clickstack_query_tiles',
    {
      title: 'Query Multiple Dashboard Tiles',
      annotations: { readOnlyHint: true },
      description:
        'Run the queries for many tiles of a dashboard in ONE call and return a ' +
        'compact per-tile success/failure summary. This is the efficient way to ' +
        'validate an entire dashboard after clickstack_save_dashboard — prefer it ' +
        'over calling clickstack_query_tile once per tile. ' +
        'Accepts a dashboard ID and an optional list of tile IDs ' +
        '(default: every non-markdown tile). Markdown tiles are skipped. ' +
        'A tile that fails is reported inline with its error; the overall call ' +
        'still succeeds so one broken tile does not hide the rest. ' +
        'Drill into a specific failing tile with clickstack_query_tile.',
      inputSchema: z.object({
        dashboardId: objectIdSchema.describe('Dashboard ID.'),
        tileIds: z
          .array(z.string())
          .optional()
          .describe(
            'Tile IDs to run. Default: every non-markdown tile on the ' +
              'dashboard. Obtain IDs from clickstack_get_dashboard.',
          ),
        startTime: z
          .string()
          .optional()
          .describe(
            'Start of the query window as ISO 8601. Default: 15 minutes ago. ' +
              'If results are empty, try a wider range (e.g. 24 hours).',
          ),
        endTime: z
          .string()
          .optional()
          .describe('End of the query window as ISO 8601. Default: now.'),
      }),
    },
    async ({ dashboardId, tileIds, startTime, endTime }) => {
      const timeRange = parseTimeRange(startTime, endTime);
      if ('error' in timeRange) {
        return mcpUserError(timeRange.error);
      }
      const { startDate, endDate } = timeRange;

      const dashboard = await Dashboard.findOne({
        _id: dashboardId,
        team: teamId,
      });
      if (!dashboard) {
        return mcpUserError('Dashboard not found');
      }

      const externalDashboard = convertToExternalDashboard(dashboard);
      const allTiles = externalDashboard.tiles;

      // Resolve the target tiles. When explicit IDs are given, keep track of
      // any that don't exist so the caller learns about typos without failing
      // the whole batch.
      let targetTiles: ExternalDashboardTileWithId[];
      const unknownTileIds: string[] = [];
      if (tileIds && tileIds.length > 0) {
        const byId = new Map(allTiles.map(t => [t.id, t]));
        targetTiles = [];
        for (const id of tileIds) {
          const tile = byId.get(id);
          if (tile) {
            targetTiles.push(tile);
          } else {
            unknownTileIds.push(id);
          }
        }
      } else {
        // Default: every non-markdown tile.
        targetTiles = allTiles.filter(t => !isMarkdownTile(t));
      }

      const queue = new PQueue({ concurrency: TILE_QUERY_CONCURRENCY });
      const queued = await Promise.all(
        targetTiles.map(tile =>
          queue.add(async (): Promise<TileSummary> => {
            const base = {
              tileId: tile.id,
              name: isConfigTile(tile) ? (tile.name ?? '') : '',
              displayType: isConfigTile(tile)
                ? tile.config.displayType
                : undefined,
            };

            // Explicitly-requested markdown tiles are reported as skipped
            // rather than run (runConfigTile would short-circuit anyway).
            if (isMarkdownTile(tile)) {
              return { ...base, status: 'skipped' };
            }

            // runConfigTile already catches ClickHouse query errors and returns
            // them as isError results. The try/catch guards against an
            // unexpected throw (e.g. a source lookup failing) so a single
            // misbehaving tile becomes an error entry instead of rejecting the
            // whole batch and hiding every other tile's result.
            try {
              const result = await runConfigTile(
                teamId.toString(),
                tile,
                startDate,
                endDate,
              );

              if ('isError' in result && result.isError) {
                return {
                  ...base,
                  status: 'error',
                  error: result.content?.[0]?.text ?? 'Unknown error',
                };
              }

              const text =
                result.content?.[0]?.type === 'text'
                  ? result.content[0].text
                  : '';
              const warnings = getRawSqlTileMacroWarnings([tile]);
              return {
                ...base,
                status: 'ok',
                ...summarizeRows(text),
                ...(warnings.length > 0 ? { warnings } : {}),
              };
            } catch (err) {
              return {
                ...base,
                status: 'error',
                error: err instanceof Error ? err.message : String(err),
              };
            }
          }),
        ),
      );
      // PQueue.add types the result as `T | void`; our task always resolves a
      // TileSummary, so drop the impossible undefined to recover the type.
      const tileSummaries: TileSummary[] = queued.filter(
        (t): t is TileSummary => t !== undefined,
      );

      const summary = {
        total: tileSummaries.length,
        ok: tileSummaries.filter(t => t.status === 'ok').length,
        error: tileSummaries.filter(t => t.status === 'error').length,
        skipped: tileSummaries.filter(t => t.status === 'skipped').length,
      };

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(
              {
                dashboardId,
                timeRange: {
                  startTime: startDate.toISOString(),
                  endTime: endDate.toISOString(),
                },
                summary,
                tiles: tileSummaries,
                ...(unknownTileIds.length > 0 ? { unknownTileIds } : {}),
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  );
}
