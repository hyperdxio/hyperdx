import { isRawSqlSavedChartConfig } from '@hyperdx/common-utils/dist/guards';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { uniq } from 'lodash';
import mongoose from 'mongoose';
import { z } from 'zod/v4';

import * as config from '@/config';
import { deleteDashboardAlerts } from '@/controllers/alerts';
import Dashboard from '@/models/dashboard';
import {
  createDashboardBodySchema,
  getMissingConnections,
  getMissingSources,
  resolveSavedQueryLanguage,
  updateDashboardBodySchema,
} from '@/routers/external-api/v2/utils/dashboards';
import {
  convertToExternalDashboard,
  convertToInternalTileConfig,
  isConfigTile,
  type SeriesTile,
} from '@/routers/external-api/v2/utils/dashboards';
import {
  translateExternalChartToTileConfig,
  translateExternalFilterToFilter,
} from '@/utils/externalApi';
import logger from '@/utils/logger';
import type {
  ExternalDashboardFilterWithId,
  ExternalDashboardTileWithId,
} from '@/utils/zod';

import { withToolTracing } from '../../utils/tracing';
import type { McpContext } from '../types';
import { mcpTilesParam } from './schemas';

export function registerSaveDashboard(
  server: McpServer,
  context: McpContext,
): void {
  const { teamId } = context;
  const frontendUrl = config.FRONTEND_URL;

  server.registerTool(
    'hyperdx_save_dashboard',
    {
      title: 'Create or Update Dashboard',
      description:
        'Create a new dashboard (omit id) or update an existing one (provide id). ' +
        'Call hyperdx_list_sources first to obtain sourceId and connectionId values. ' +
        'IMPORTANT: After saving a dashboard, always run hyperdx_query_tile on each tile ' +
        'to confirm the queries work and return expected data. Tiles can silently fail ' +
        'due to incorrect filter syntax, missing attributes, or wrong column names.',
      inputSchema: z.object({
        id: z
          .string()
          .optional()
          .describe(
            'Dashboard ID. Omit to create a new dashboard, provide to update an existing one.',
          ),
        name: z.string().describe('Dashboard name'),
        tiles: mcpTilesParam,
        tags: z.array(z.string()).optional().describe('Dashboard tags'),
      }),
    },
    withToolTracing(
      'hyperdx_save_dashboard',
      context,
      async ({ id: dashboardId, name, tiles: inputTiles, tags }) => {
        if (!dashboardId) {
          return createDashboard({
            teamId,
            frontendUrl,
            name,
            inputTiles,
            tags,
          });
        }
        return updateDashboard({
          teamId,
          frontendUrl,
          dashboardId,
          name,
          inputTiles,
          tags,
        });
      },
    ),
  );
}

// ─── Create helper ────────────────────────────────────────────────────────────

async function createDashboard({
  teamId,
  frontendUrl,
  name,
  inputTiles,
  tags,
}: {
  teamId: string;
  frontendUrl: string | undefined;
  name: string;
  inputTiles: unknown[];
  tags: string[] | undefined;
}) {
  const parsed = createDashboardBodySchema.safeParse({
    name,
    tiles: inputTiles,
    tags,
  });
  if (!parsed.success) {
    return {
      isError: true,
      content: [
        {
          type: 'text' as const,
          text: `Validation error: ${JSON.stringify(parsed.error.errors)}`,
        },
      ],
    };
  }

  const { tiles, filters } = parsed.data;
  const tilesWithId = tiles as ExternalDashboardTileWithId[];

  const [missingSources, missingConnections] = await Promise.all([
    getMissingSources(teamId, tilesWithId, filters),
    getMissingConnections(teamId, tilesWithId),
  ]);
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

  const internalTiles = tilesWithId.map(tile => {
    const tileId = new mongoose.Types.ObjectId().toString();
    if (isConfigTile(tile)) {
      return convertToInternalTileConfig({ ...tile, id: tileId });
    }
    return translateExternalChartToTileConfig({
      ...tile,
      id: tileId,
    } as SeriesTile);
  });

  const filtersWithIds = (filters ?? []).map(filter =>
    translateExternalFilterToFilter({
      ...filter,
      id: new mongoose.Types.ObjectId().toString(),
    }),
  );

  const normalizedSavedQueryLanguage = resolveSavedQueryLanguage({
    savedQuery: undefined,
    savedQueryLanguage: undefined,
  });

  const newDashboard = await new Dashboard({
    name: parsed.data.name,
    tiles: internalTiles,
    tags: tags && uniq(tags),
    filters: filtersWithIds,
    savedQueryLanguage: normalizedSavedQueryLanguage,
    savedFilterValues: parsed.data.savedFilterValues,
    team: teamId,
  }).save();

  return {
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify(
          {
            ...convertToExternalDashboard(newDashboard),
            ...(frontendUrl
              ? { url: `${frontendUrl}/dashboards/${newDashboard._id}` }
              : {}),
            hint: 'Use hyperdx_query to test individual tile queries before viewing the dashboard.',
          },
          null,
          2,
        ),
      },
    ],
  };
}

// ─── Update helper ────────────────────────────────────────────────────────────

async function updateDashboard({
  teamId,
  frontendUrl,
  dashboardId,
  name,
  inputTiles,
  tags,
}: {
  teamId: string;
  frontendUrl: string | undefined;
  dashboardId: string;
  name: string;
  inputTiles: unknown[];
  tags: string[] | undefined;
}) {
  const parsed = updateDashboardBodySchema.safeParse({
    name,
    tiles: inputTiles,
    tags,
  });
  if (!parsed.success) {
    return {
      isError: true,
      content: [
        {
          type: 'text' as const,
          text: `Validation error: ${JSON.stringify(parsed.error.errors)}`,
        },
      ],
    };
  }

  const { tiles, filters } = parsed.data;
  const tilesWithId = tiles as ExternalDashboardTileWithId[];

  const [missingSources, missingConnections] = await Promise.all([
    getMissingSources(teamId, tilesWithId, filters),
    getMissingConnections(teamId, tilesWithId),
  ]);
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

  const existingDashboard = await Dashboard.findOne(
    { _id: dashboardId, team: teamId },
    { tiles: 1, filters: 1 },
  ).lean();

  if (!existingDashboard) {
    return {
      isError: true,
      content: [{ type: 'text' as const, text: 'Dashboard not found' }],
    };
  }

  const existingTileIds = new Set(
    (existingDashboard.tiles ?? []).map((t: { id: string }) => t.id),
  );
  const existingFilterIds = new Set(
    (existingDashboard.filters ?? []).map((f: { id: string }) => f.id),
  );

  const internalTiles = tilesWithId.map(tile => {
    const tileId =
      tile.id && existingTileIds.has(tile.id)
        ? tile.id
        : new mongoose.Types.ObjectId().toString();
    if (isConfigTile(tile)) {
      return convertToInternalTileConfig({ ...tile, id: tileId });
    }
    return translateExternalChartToTileConfig({
      ...tile,
      id: tileId,
    } as SeriesTile);
  });

  const setPayload: Record<string, unknown> = {
    name,
    tiles: internalTiles,
    tags: tags && uniq(tags),
  };

  if (filters !== undefined) {
    setPayload.filters = filters.map(
      (filter: ExternalDashboardFilterWithId) => {
        const filterId = existingFilterIds.has(filter.id)
          ? filter.id
          : new mongoose.Types.ObjectId().toString();
        return translateExternalFilterToFilter({ ...filter, id: filterId });
      },
    );
  }

  const normalizedSavedQueryLanguage = resolveSavedQueryLanguage({
    savedQuery: undefined,
    savedQueryLanguage: undefined,
  });
  if (normalizedSavedQueryLanguage !== undefined) {
    setPayload.savedQueryLanguage = normalizedSavedQueryLanguage;
  }

  if (parsed.data.savedFilterValues !== undefined) {
    setPayload.savedFilterValues = parsed.data.savedFilterValues;
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

  // Delete alerts for raw SQL tiles (unsupported) or removed tiles
  const newTileIdSet = new Set(internalTiles.map(t => t.id));
  const tileIdsToDeleteAlerts = [
    ...internalTiles
      .filter(tile => isRawSqlSavedChartConfig(tile.config))
      .map(tile => tile.id),
    ...[...existingTileIds].filter(id => !newTileIdSet.has(id)),
  ];
  if (tileIdsToDeleteAlerts.length > 0) {
    logger.info(
      { dashboardId, teamId, tileIds: tileIdsToDeleteAlerts },
      'Deleting alerts for tiles with unsupported config or removed tiles',
    );
    await deleteDashboardAlerts(
      dashboardId,
      new mongoose.Types.ObjectId(teamId),
      tileIdsToDeleteAlerts,
    );
  }

  return {
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify(
          {
            ...convertToExternalDashboard(updatedDashboard),
            ...(frontendUrl
              ? { url: `${frontendUrl}/dashboards/${updatedDashboard._id}` }
              : {}),
            hint: 'Use hyperdx_query to test individual tile queries before viewing the dashboard.',
          },
          null,
          2,
        ),
      },
    ],
  };
}
