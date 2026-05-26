import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { uniq } from 'lodash';
import mongoose from 'mongoose';
import { z } from 'zod';

import * as config from '@/config';
import Dashboard, { IDashboard } from '@/models/dashboard';
import {
  cleanupDashboardAlerts,
  collectTileContainerRefIssues,
  convertExternalTilesToInternal,
  convertToExternalDashboard,
  fetchSourcesForValidation,
  filterChangedHeatmapTiles,
  getHeatmapTilesWithIncompatibleSources,
  getInvalidOnClickSearchSources,
  getMissingConnections,
  getMissingOnClickDashboards,
  getMissingSources,
} from '@/routers/external-api/v2/utils/dashboards';
import type { ExternalDashboardTileWithId } from '@/utils/zod';

import { withToolTracing } from '../../utils/tracing';
import type { McpContext } from '../types';
import { mcpPatchTileSchema } from './schemas';

export function registerPatchDashboard(
  server: McpServer,
  context: McpContext,
): void {
  const { teamId } = context;
  const frontendUrl = config.FRONTEND_URL;

  server.registerTool(
    'hyperdx_patch_dashboard',
    {
      title: 'Patch Dashboard',
      description:
        'Make targeted updates to a dashboard without resubmitting the full object. ' +
        'You can update dashboard-level fields (name, tags) and/or replace a single ' +
        'tile by tileId \u2014 all in one call. Unmentioned tiles and fields are preserved. ' +
        'Use hyperdx_get_dashboard_tile to inspect a tile before patching it. ' +
        'IMPORTANT: After patching a tile, run hyperdx_query_tile to confirm the query still works.',
      inputSchema: z.object({
        dashboardId: z.string().describe('Dashboard ID.'),
        name: z
          .string()
          .min(1)
          .optional()
          .describe('New dashboard name. Omit to keep the current name.'),
        tags: z
          .array(z.string())
          .optional()
          .describe(
            'New tags array (replaces all existing tags). Omit to keep the current tags.',
          ),
        tileId: z
          .string()
          .optional()
          .describe(
            'ID of the tile to replace. Must be paired with `tile`. ' +
              'Obtain tile IDs from hyperdx_get_dashboard.',
          ),
        tile: mcpPatchTileSchema
          .optional()
          .describe(
            'The full replacement tile definition. Replaces the tile matched by tileId. ' +
              'Layout fields (x, y, w, h) and containerId/tabId default to the existing ' +
              "tile's values when omitted, so you only need to specify what changed.",
          ),
      }),
    },
    withToolTracing(
      'hyperdx_patch_dashboard',
      context,
      async ({ dashboardId, name, tags, tileId, tile: inputTile }) => {
        // Cross-field validation (kept in handler so the inputSchema
        // stays a plain z.object and its properties are visible in the
        // JSON Schema that the MCP SDK exposes to LLMs).
        if (
          name === undefined &&
          tags === undefined &&
          (tileId === undefined || inputTile === undefined)
        ) {
          return {
            isError: true,
            content: [
              {
                type: 'text' as const,
                text: 'Provide at least one of: name, tags, or tileId+tile to patch.',
              },
            ],
          };
        }
        if ((tileId === undefined) !== (inputTile === undefined)) {
          return {
            isError: true,
            content: [
              {
                type: 'text' as const,
                text: 'tileId and tile must both be provided or both omitted.',
              },
            ],
          };
        }

        if (!mongoose.Types.ObjectId.isValid(dashboardId)) {
          return {
            isError: true,
            content: [{ type: 'text' as const, text: 'Invalid dashboard ID' }],
          };
        }

        const existingDashboard = await Dashboard.findOne({
          _id: dashboardId,
          team: teamId,
        });
        if (!existingDashboard) {
          return {
            isError: true,
            content: [{ type: 'text' as const, text: 'Dashboard not found' }],
          };
        }

        const externalDashboard = convertToExternalDashboard(existingDashboard);
        let patchedTiles = externalDashboard.tiles;
        let patchedTile: ExternalDashboardTileWithId | undefined;

        // ── Tile-level patch ─────────────────────────────────────────
        if (tileId !== undefined && inputTile !== undefined) {
          const tileIndex = externalDashboard.tiles.findIndex(
            t => t.id === tileId,
          );
          if (tileIndex === -1) {
            return {
              isError: true,
              content: [
                {
                  type: 'text' as const,
                  text: `Tile not found: ${tileId}. Available tile IDs: ${externalDashboard.tiles.map(t => `${t.id} (${t.name})`).join(', ')}`,
                },
              ],
            };
          }

          const existingTile = externalDashboard.tiles[tileIndex];

          // Merge: the incoming tile definition replaces config/name,
          // but layout and container refs fall back to the existing tile
          // when omitted so the LLM doesn't have to re-specify them.
          // Cast once; the Zod schema already validated the shape.
          const incoming = inputTile as Partial<ExternalDashboardTileWithId>;
          const mergedTile: ExternalDashboardTileWithId = {
            ...existingTile,
            ...incoming,
            id: tileId, // preserve the original tile ID
            x: incoming.x ?? existingTile.x,
            y: incoming.y ?? existingTile.y,
            w: incoming.w ?? existingTile.w,
            h: incoming.h ?? existingTile.h,
            containerId:
              'containerId' in incoming
                ? incoming.containerId
                : existingTile.containerId,
            tabId: 'tabId' in incoming ? incoming.tabId : existingTile.tabId,
          };

          // Validate the patched tile: sources, connections, heatmap,
          // onClick, container refs — same checks as the full update
          // path, but scoped to the single changed tile.
          const tilesToValidate = [mergedTile];

          const [
            sources,
            missingConnections,
            missingOnClickDashboards,
            invalidOnClickSearchSources,
          ] = await Promise.all([
            fetchSourcesForValidation(teamId),
            getMissingConnections(teamId, tilesToValidate),
            getMissingOnClickDashboards(teamId, tilesToValidate),
            getInvalidOnClickSearchSources(teamId, tilesToValidate),
          ]);

          const missingSources = getMissingSources(sources, tilesToValidate);
          if (missingSources.length > 0) {
            return {
              isError: true,
              content: [
                {
                  type: 'text' as const,
                  text: `Could not find source IDs: ${missingSources.join(', ')}`,
                },
              ],
            };
          }
          if (missingConnections.length > 0) {
            return {
              isError: true,
              content: [
                {
                  type: 'text' as const,
                  text: `Could not find connection IDs: ${missingConnections.join(', ')}`,
                },
              ],
            };
          }

          // Heatmap source-kind gate, scoped to tiles whose source or
          // displayType changed from the existing version.
          const heatmapNonTraceSources = getHeatmapTilesWithIncompatibleSources(
            sources,
            filterChangedHeatmapTiles(
              tilesToValidate,
              existingDashboard.tiles ?? [],
            ),
          );
          if (heatmapNonTraceSources.length > 0) {
            return {
              isError: true,
              content: [
                {
                  type: 'text' as const,
                  text: `Heatmap tiles require a Trace source. The following source IDs are not Trace sources: ${heatmapNonTraceSources.join(', ')}`,
                },
              ],
            };
          }

          if (missingOnClickDashboards.length > 0) {
            return {
              isError: true,
              content: [
                {
                  type: 'text' as const,
                  text: `Could not find the following onClick dashboard IDs: ${missingOnClickDashboards.join(', ')}`,
                },
              ],
            };
          }
          if (invalidOnClickSearchSources.length > 0) {
            return {
              isError: true,
              content: [
                {
                  type: 'text' as const,
                  text: `The following onClick search source IDs are not log or trace sources: ${invalidOnClickSearchSources.join(', ')}`,
                },
              ],
            };
          }

          // Container/tab ref validation against the dashboard's containers.
          const effectiveContainers = existingDashboard.containers ?? [];
          const tileRefIssues = collectTileContainerRefIssues(
            effectiveContainers,
            tilesToValidate,
          );
          if (tileRefIssues.length > 0) {
            return {
              isError: true,
              content: [
                {
                  type: 'text' as const,
                  text: `Validation error: ${tileRefIssues.join('; ')}`,
                },
              ],
            };
          }

          // Replace the tile in the full array.
          patchedTiles = [...externalDashboard.tiles];
          patchedTiles[tileIndex] = mergedTile;
          patchedTile = mergedTile;
        }

        // ── Build the $set payload ──────────────────────────────────
        const existingTileIds = new Set(
          (existingDashboard.tiles ?? []).map((t: { id: string }) => t.id),
        );
        const internalTiles = convertExternalTilesToInternal(
          patchedTiles,
          existingTileIds,
        );

        const setPayload: Partial<IDashboard> = {};

        if (name !== undefined) {
          setPayload.name = name;
        }
        if (tags !== undefined) {
          setPayload.tags = uniq(tags);
        }
        if (tileId !== undefined) {
          setPayload.tiles = internalTiles;
        }

        const updatedDashboard = await Dashboard.findOneAndUpdate(
          { _id: dashboardId, team: teamId },
          { $set: setPayload },
          { new: true },
        );

        if (!updatedDashboard) {
          return {
            isError: true,
            content: [{ type: 'text' as const, text: 'Dashboard not found' }],
          };
        }

        // Clean up alerts for tiles that were removed or converted to
        // unsupported config types.
        if (tileId !== undefined) {
          await cleanupDashboardAlerts({
            dashboardId,
            teamId,
            internalTiles,
            existingTileIds,
          });
        }

        // Return a lightweight response: the patched tile (if any) plus
        // updated dashboard metadata, without the full tile array.
        const output: Record<string, unknown> = {
          id: updatedDashboard._id.toString(),
          name: updatedDashboard.name,
          tags: updatedDashboard.tags,
          ...(frontendUrl
            ? { url: `${frontendUrl}/dashboards/${updatedDashboard._id}` }
            : {}),
        };
        if (patchedTile) {
          output.patchedTile = patchedTile;
          output.hint =
            'Use hyperdx_query_tile to test the patched tile query.';
        }

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(output, null, 2),
            },
          ],
        };
      },
    ),
  );
}
