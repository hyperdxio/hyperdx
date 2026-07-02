import { uniq } from 'lodash';

import * as config from '@/config';
import type { ToolRegistrar } from '@/mcp/tools/types';
import { mcpUserError } from '@/mcp/utils/errors';
import Dashboard from '@/models/dashboard';
import {
  cleanupDashboardAlerts,
  convertToExternalDashboard,
  convertToInternalTileConfig,
  isConfigTile,
  validateDashboardTiles,
} from '@/routers/external-api/v2/utils/dashboards';
import type { ExternalDashboardTileWithId } from '@/utils/zod';

import { mcpPatchDashboardSchema } from './schemas';
import {
  getRawSqlMissingSourceError,
  getRawSqlTileMacroWarnings,
} from './validation';

export function registerPatchDashboard({
  context,
  registerTool,
}: ToolRegistrar): void {
  const { teamId } = context;
  const frontendUrl = config.FRONTEND_URL;

  registerTool(
    'clickstack_patch_dashboard',
    {
      title: 'Patch Dashboard',
      description:
        'Make targeted updates to a dashboard without resubmitting the full object. ' +
        'You can update dashboard-level fields (name, tags) and/or replace a single ' +
        'tile by tileId \u2014 all in one call. Unmentioned tiles and fields are preserved. ' +
        'Use clickstack_get_dashboard_tile to inspect a tile before patching it. ' +
        'IMPORTANT: After patching a tile, run clickstack_query_tile to confirm the query still works.',
      inputSchema: mcpPatchDashboardSchema,
    },
    async ({ dashboardId, name, tags, tileId, tile: inputTile }) => {
      // Cross-field validation (kept in handler so the inputSchema
      // stays a plain z.object and its properties are visible in the
      // JSON Schema that the MCP SDK exposes to LLMs).
      if (
        name === undefined &&
        tags === undefined &&
        (tileId === undefined || inputTile === undefined)
      ) {
        return mcpUserError(
          'Provide at least one of: name, tags, or tileId+tile to patch.',
        );
      }
      if ((tileId === undefined) !== (inputTile === undefined)) {
        return mcpUserError(
          'tileId and tile must both be provided or both omitted.',
        );
      }

      const existingDashboard = await Dashboard.findOne({
        _id: dashboardId,
        team: teamId,
      });
      if (!existingDashboard) {
        return mcpUserError('Dashboard not found');
      }

      // Build the $set payload and the query filter. Metadata fields
      // are simple top-level $set entries; the tile patch uses the
      // positional $ operator matched by 'tiles.id' in the filter.
      const setPayload: Record<string, unknown> = {};
      const queryFilter: Record<string, unknown> = {
        _id: dashboardId,
        team: teamId,
      };

      if (name !== undefined) {
        setPayload.name = name;
      }
      if (tags !== undefined) {
        setPayload.tags = uniq(tags);
      }

      let patchedTile: ExternalDashboardTileWithId | undefined;

      // ── Tile-level patch ─────────────────────────────────────────
      if (tileId !== undefined && inputTile !== undefined) {
        // Work directly with the persisted internal tiles array so
        // untouched tiles are never round-tripped through the external
        // converter (which would strip orphaned container refs from
        // unrelated tiles).
        const internalTiles =
          (existingDashboard.tiles as { id: string }[]) ?? [];
        const existingIdx = internalTiles.findIndex(t => t.id === tileId);
        if (existingIdx === -1) {
          // Build a human-readable list of available tile IDs.
          // Convert only for the error message (read-only, no write-back).
          const externalDashboard =
            convertToExternalDashboard(existingDashboard);
          return mcpUserError(
            `Tile not found: ${tileId}. Available tile IDs: ${externalDashboard.tiles.map(t => `${t.id} (${t.name})`).join(', ')}`,
          );
        }

        // Read the existing tile's layout and container refs from the
        // persisted internal format so fallback values are accurate
        // regardless of the external converter's self-healing logic.
        const existingInternalTile = internalTiles[existingIdx] as {
          id: string;
          x?: number;
          y?: number;
          w?: number;
          h?: number;
          containerId?: string;
          tabId?: string;
          config?: { name?: string };
        };

        // Merge: the incoming tile definition replaces config/name,
        // but layout and container refs fall back to the existing tile
        // when omitted so the LLM doesn't have to re-specify them.
        // Coerce legacy empty-string containerId/tabId to undefined so
        // they don't trip the container-ref validator (mirrors the
        // self-heal in convertTileToExternalChart).
        const incoming = inputTile as Partial<ExternalDashboardTileWithId>;
        const existingContainerId =
          existingInternalTile.containerId || undefined;
        const existingTabId = existingInternalTile.tabId || undefined;
        const mergedTile: ExternalDashboardTileWithId = {
          id: tileId,
          name: incoming.name ?? existingInternalTile.config?.name ?? '',
          x: incoming.x ?? existingInternalTile.x ?? 0,
          y: incoming.y ?? existingInternalTile.y ?? 0,
          w: incoming.w ?? existingInternalTile.w ?? 12,
          h: incoming.h ?? existingInternalTile.h ?? 4,
          containerId:
            'containerId' in incoming
              ? incoming.containerId
              : existingContainerId,
          tabId: 'tabId' in incoming ? incoming.tabId : existingTabId,
          // The config comes from the incoming tile (validated by Zod).
          config: incoming.config,
        } as ExternalDashboardTileWithId;

        // Error on raw SQL tiles that have no source defined but which use
        // macros which require a source to be set
        const sqlFilterSourceError = getRawSqlMissingSourceError([mergedTile]);
        if (sqlFilterSourceError) {
          return mcpUserError(sqlFilterSourceError);
        }

        // Validate the patched tile using the shared validation helper.
        const validationError = await validateDashboardTiles({
          teamId,
          tiles: [mergedTile],
          existingTiles: existingDashboard.tiles ?? [],
          containers: existingDashboard.containers ?? [],
        });
        if (validationError) {
          return mcpUserError(validationError);
        }

        // Convert only the patched tile to internal format.
        if (!isConfigTile(mergedTile)) {
          return mcpUserError('Tile must have a config block.');
        }
        const internalTile = convertToInternalTileConfig(mergedTile);

        // Use the positional $ operator matched by 'tiles.id' in the
        // query filter. This targets the tile by its id field rather
        // than a captured numeric index, so a concurrent save_dashboard
        // that replaces the whole tiles array can't cause us to
        // overwrite an unrelated tile at a stale index.
        queryFilter['tiles.id'] = tileId;
        setPayload['tiles.$'] = internalTile;
        patchedTile = mergedTile;
      }

      const updatedDashboard = await Dashboard.findOneAndUpdate(
        queryFilter,
        { $set: setPayload },
        { new: true },
      );

      if (!updatedDashboard) {
        // When a tile patch is in flight, a null result means the tile
        // was removed or the dashboard was deleted between our read
        // and this write.
        if (tileId !== undefined) {
          return mcpUserError(
            `Tile ${tileId} was not found at write time (it may have been removed by a concurrent update). ` +
              'The entire update was rejected — name/tags changes (if any) were not applied. Resubmit.',
          );
        }
        return mcpUserError('Dashboard not found');
      }

      // Reconcile alerts: if the tile's displayType changed to one
      // that doesn't support alerts (e.g. raw SQL line/pie), clean up
      // stale alert documents. Scope to just the patched tile — pass
      // it as both the "new" tiles and "existing" ids so the helper
      // checks whether the updated config still supports alerts.
      if (tileId !== undefined) {
        const existingTileIds = new Set([tileId]);
        const patchedTileInDb = updatedDashboard.tiles.filter(
          t => t.id === tileId,
        );
        await cleanupDashboardAlerts({
          dashboardId,
          teamId,
          internalTiles: patchedTileInDb,
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
          'Use clickstack_query_tile to test the patched tile query.';
        const macroWarnings = getRawSqlTileMacroWarnings([patchedTile]);
        if (macroWarnings.length > 0) {
          output.warnings = macroWarnings;
        }
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
  );
}
