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

/**
 * Soft cap on how many tiles a single call will run. A pathological dashboard
 * (or a very long explicit `tileIds` list) would otherwise turn one MCP call
 * into an unbounded run of ClickHouse queries. Tiles past the cap are returned
 * as `unrunTileIds` so nothing is silently dropped — the caller can page
 * through the remainder in a follow-up call.
 */
const MAX_TILES_PER_CALL = 50;

/**
 * Hard cap on the length of an explicit `tileIds` array. The execution cap
 * above bounds how many tiles we *run*, but without this an authenticated
 * caller could still submit a giant id array whose traversal, dedupe set, and
 * echoed `unknownTileIds` all scale with the unbounded input. Rejecting at the
 * schema keeps the whole request proportional to a real dashboard.
 */
const MAX_TILE_IDS_INPUT = 500;

/**
 * Whole-call wall-clock budget. With a 50-tile cap at concurrency 2 and a
 * per-tile ClickHouse timeout, a fully-slow batch could otherwise block for
 * many minutes — long enough that the MCP transport times out and discards the
 * carefully-preserved partial results. When a tile exceeds this budget its
 * task resolves as a timed-out `error` entry instead of hanging the batch.
 */
const TILE_QUERY_TIMEOUT_MS = 30_000;

/** A tile whose displayType is markdown (or that has no queryable config). */
function isMarkdownTile(tile: ExternalDashboardTileWithId): boolean {
  if (!isConfigTile(tile)) return true;
  return tile.config.displayType === 'markdown';
}

/**
 * Marker error so the per-tile catch can render a clear timeout message.
 *
 * @internal Exported for testing only.
 */
export class TileDeadlineError extends Error {
  constructor(ms: number) {
    super(`Tile query exceeded the ${ms}ms batch deadline`);
    this.name = 'TileDeadlineError';
  }
}

/**
 * Race a tile query against a wall-clock deadline. Rejecting with
 * TileDeadlineError lets the existing per-tile catch fold the timeout into a
 * `status:'error'` entry, so a single slow tile can't hold the whole batch
 * open past the point the MCP transport gives up.
 *
 * @internal Exported for testing only.
 */
export async function withDeadline<T>(
  work: Promise<T>,
  ms: number,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new TileDeadlineError(ms)), ms);
  });
  try {
    return await Promise.race([work, deadline]);
  } finally {
    clearTimeout(timer!);
  }
}

/**
 * Derive a compact data summary from a successful tile query payload. The
 * payload shape is `{ result: <data>, ... }` where `<data>` is either an array
 * of rows or an object carrying a `data: [...]` array (see formatQueryResult in
 * query/helpers.ts). Anything we can't confidently read as rows is reported as
 * `hasData: undefined` rather than guessed.
 *
 * @internal Exported for testing only.
 */
export function summarizeRows(text: string): {
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
        'Markdown tiles are excluded by default; a markdown tile passed ' +
        'explicitly in tileIds is returned with status "skipped". ' +
        'Unrecognized tile IDs are returned as unknownTileIds rather than ' +
        'failing the call. ' +
        'At most 50 tiles run per call; any beyond that are returned as ' +
        'unrunTileIds — call again with those as tileIds to run the remainder. ' +
        'Drill into a specific failing tile with clickstack_query_tile.',
      inputSchema: z.object({
        dashboardId: objectIdSchema.describe('Dashboard ID.'),
        tileIds: z
          .array(z.string())
          .max(MAX_TILE_IDS_INPUT)
          .optional()
          .describe(
            'Tile IDs to run. Default: every non-markdown tile on the ' +
              'dashboard. Obtain IDs from clickstack_get_dashboard. ' +
              `At most ${MAX_TILE_IDS_INPUT} IDs per call.`,
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

      // Resolve the target tiles. When explicit IDs are given, dedupe them
      // (a repeated id must not run — or be counted — twice) and keep track of
      // any that don't exist so the caller learns about typos without failing
      // the whole batch.
      let selectedTiles: ExternalDashboardTileWithId[];
      const unknownTileIds: string[] = [];
      if (tileIds && tileIds.length > 0) {
        const byId = new Map(allTiles.map(t => [t.id, t]));
        selectedTiles = [];
        const seen = new Set<string>();
        for (const id of tileIds) {
          if (seen.has(id)) continue;
          seen.add(id);
          const tile = byId.get(id);
          if (tile) {
            selectedTiles.push(tile);
          } else {
            unknownTileIds.push(id);
          }
        }
      } else {
        // Default: every non-markdown tile.
        selectedTiles = allTiles.filter(t => !isMarkdownTile(t));
      }

      // Soft-cap the number of tiles run per call so one request can't fan out
      // into an unbounded run of ClickHouse queries. Anything past the cap is
      // reported back as unrun rather than silently dropped.
      const targetTiles = selectedTiles.slice(0, MAX_TILES_PER_CALL);
      const unrunTileIds = selectedTiles
        .slice(MAX_TILES_PER_CALL)
        .map(t => t.id);

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
            // unexpected throw (e.g. a source lookup failing) or a deadline
            // timeout so a single misbehaving tile becomes an error entry
            // instead of rejecting the whole batch and hiding every other
            // tile's result.
            try {
              const result = await withDeadline(
                runConfigTile(teamId.toString(), tile, startDate, endDate),
                TILE_QUERY_TIMEOUT_MS,
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
                ...(unrunTileIds.length > 0 ? { unrunTileIds } : {}),
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
