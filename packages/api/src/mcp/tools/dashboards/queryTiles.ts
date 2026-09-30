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

import {
  getRawSqlTileMacroWarnings,
  getTileVariableWarnings,
} from './validation';
import { mcpVariableValuesParam, resolveDashboardVariables } from './variables';

/**
 * How many tiles to query against ClickHouse at once. Kept lowish so a batch
 * validation of a large dashboard doesn't hammer the connection — each tile is
 * a full chart-config query.
 *
 * @internal Exported for testing only.
 */
export const TILE_QUERY_CONCURRENCY = 6;

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
 * Whole-call wall-clock budget, shared across the entire batch (NOT per tile).
 * A single deadline is fixed when the run starts; every tile races against the
 * time *remaining* until it. Without this, a large dashboard's tiles each with
 * their own multi-second timeout could serialize into many minutes — long
 * enough that the MCP transport gives up and discards the carefully-preserved
 * partial results. Tiles that don't finish (or never start) before the budget
 * is spent resolve as timed-out `error` entries, so the call as a whole returns
 * within roughly this bound with whatever completed.
 */
const BATCH_DEADLINE_MS = 60_000;

/** A tile whose displayType is markdown (or that has no queryable config). */
function isMarkdownTile(tile: ExternalDashboardTileWithId): boolean {
  if (!isConfigTile(tile)) return true;
  return tile.config.displayType === 'markdown';
}

/**
 * Marker error so the per-tile catch can render a clear timeout message.
 * Raised both when a started query overruns the deadline and when a queued
 * tile's deadline has already passed before it could start.
 *
 * @internal Exported for testing only.
 */
export class TileDeadlineError extends Error {
  constructor() {
    super('Tile query exceeded the batch wall-clock deadline');
    this.name = 'TileDeadlineError';
  }
}

/**
 * Run `startWork` under a SHARED absolute deadline (epoch millis) — every tile
 * in a batch passes the same `deadlineAt`, making the budget whole-call.
 *
 * `startWork` is a thunk, not an already-started promise, so the deadline is
 * checked BEFORE the query is issued: once the budget is spent, tiles PQueue
 * schedules during the drain fail fast without touching ClickHouse.
 *
 * A tile that did start races the timer. When the deadline elapses we both
 * reject AND abort the `AbortSignal` handed to `startWork`, so the in-flight
 * ClickHouse query is cancelled server-side rather than left running headless
 * until it finishes on its own. The signal is also aborted on any other exit
 * (the work throwing, or resolving after we already lost the race is a no-op),
 * so a query never outlives the call it belongs to.
 *
 * @internal Exported for testing only.
 */
export async function withDeadline<T>(
  startWork: (signal: AbortSignal) => Promise<T>,
  deadlineAt: number,
): Promise<T> {
  const remaining = deadlineAt - Date.now();
  // Budget already spent — fail fast without starting the work at all.
  if (remaining <= 0) {
    throw new TileDeadlineError();
  }
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout>;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      // Cancel the query in ClickHouse, then surface the timeout.
      controller.abort();
      reject(new TileDeadlineError());
    }, remaining);
  });
  try {
    return await Promise.race([startWork(controller.signal), deadline]);
  } finally {
    clearTimeout(timer!);
    // Belt-and-suspenders: abort on any exit so a query started by a thunk
    // that then rejected for another reason is never left running.
    controller.abort();
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
        'Accepts a dashboard ID and an optional list of tile IDs. ' +
        'Markdown tiles are excluded by default; a markdown tile passed ' +
        'explicitly in tileIds is returned with status "skipped". ' +
        'A tile that fails is reported inline with its error and the overall ' +
        'call still succeeds, so one broken tile does not hide the rest, and ' +
        'unrecognized tile IDs come back as unknownTileIds rather than failing. ' +
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
        variableValues: mcpVariableValuesParam.optional(),
      }),
    },
    async ({ dashboardId, tileIds, startTime, endTime, variableValues }) => {
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

      const resolved = resolveDashboardVariables(
        externalDashboard.filters,
        variableValues,
      );
      if ('error' in resolved) {
        return mcpUserError(resolved.error);
      }
      const { variables } = resolved;

      // Resolve the target tiles. An explicit `tileIds` array is honored
      // whenever the field is present — including an empty array, which
      // deliberately selects nothing rather than falling through to "run
      // everything". Only an omitted field defaults to all non-markdown tiles.
      // Explicit IDs are deduped (a repeated id must not run — or be counted —
      // twice); unknown IDs are tracked so the caller learns about typos
      // without failing the whole batch.
      let selectedTiles: ExternalDashboardTileWithId[];
      const unknownTileIds: string[] = [];
      if (tileIds !== undefined) {
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

      // Apply the execution cap; the overflow is surfaced as unrunTileIds.
      const targetTiles = selectedTiles.slice(0, MAX_TILES_PER_CALL);
      const unrunTileIds = selectedTiles
        .slice(MAX_TILES_PER_CALL)
        .map(t => t.id);

      // Fix one shared deadline for the whole batch that every tile races.
      const deadlineAt = Date.now() + BATCH_DEADLINE_MS;

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

            // Run the query under the shared deadline. It's passed as a thunk
            // so withDeadline can skip issuing it entirely once the budget is
            // spent (see withDeadline). withDeadline hands the thunk an
            // AbortSignal it fires on timeout; threading it into runConfigTile
            // cancels the in-flight ClickHouse query instead of leaving it to
            // run headless. runConfigTile turns ClickHouse errors into isError
            // results; the try/catch covers an unexpected throw or a deadline
            // timeout, folding either into a status:'error' entry so one
            // misbehaving tile never rejects the whole batch.
            try {
              const result = await withDeadline(
                signal =>
                  runConfigTile(teamId.toString(), tile, startDate, endDate, {
                    abortSignal: signal,
                    variables,
                  }),
                deadlineAt,
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
              const warnings = [
                ...getRawSqlTileMacroWarnings([tile]),
                ...getTileVariableWarnings([tile], externalDashboard.filters),
              ];
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
