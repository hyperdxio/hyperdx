import type { DashboardContainer } from '@hyperdx/common-utils/dist/types';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { uniq } from 'lodash';
import mongoose from 'mongoose';
import { z } from 'zod';

import * as config from '@/config';
import Dashboard from '@/models/dashboard';
import {
  cleanupDashboardAlerts,
  collectTileContainerRefIssues,
  convertExternalFiltersToInternal,
  convertExternalTilesToInternal,
  convertToExternalDashboard,
  createDashboardBodySchema,
  getMissingConnections,
  getMissingSources,
  resolveSavedQueryLanguage,
  updateDashboardBodySchema,
} from '@/routers/external-api/v2/utils/dashboards';
import type { ExternalDashboardTileWithId } from '@/utils/zod';

import { withToolTracing } from '../../utils/tracing';
import type { McpContext } from '../types';
import { mcpContainersParam, mcpTilesParam } from './schemas';

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
        containers: mcpContainersParam.optional(),
      }),
    },
    withToolTracing(
      'hyperdx_save_dashboard',
      context,
      async ({
        id: dashboardId,
        name,
        tiles: inputTiles,
        tags,
        containers,
      }) => {
        if (!dashboardId) {
          return createDashboard({
            teamId,
            frontendUrl,
            name,
            inputTiles,
            tags,
            containers,
          });
        }
        return updateDashboard({
          teamId,
          frontendUrl,
          dashboardId,
          name,
          inputTiles,
          tags,
          containers,
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
  containers,
}: {
  teamId: string;
  frontendUrl: string | undefined;
  name: string;
  inputTiles: unknown[];
  tags: string[] | undefined;
  containers: DashboardContainer[] | undefined;
}) {
  const parsed = createDashboardBodySchema.safeParse({
    name,
    tiles: inputTiles,
    tags,
    containers,
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

  const { tiles, filters, containers: parsedContainers } = parsed.data;
  const tilesWithId = tiles as ExternalDashboardTileWithId[];

  // Mirror the v2 router POST handler: structural container checks ran
  // through the body schema; per-tile containerId/tabId resolution runs
  // against the request body's containers (no existing dashboard to fall
  // back to on create).
  const tileRefIssues = collectTileContainerRefIssues(
    parsedContainers ?? [],
    tilesWithId,
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

  const internalTiles = convertExternalTilesToInternal(tilesWithId);
  const filtersWithIds = convertExternalFiltersToInternal(filters ?? []);

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
    ...(parsedContainers !== undefined ? { containers: parsedContainers } : {}),
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
  containers,
}: {
  teamId: string;
  frontendUrl: string | undefined;
  dashboardId: string;
  name: string;
  inputTiles: unknown[];
  tags: string[] | undefined;
  containers: DashboardContainer[] | undefined;
}) {
  if (!mongoose.Types.ObjectId.isValid(dashboardId)) {
    return {
      isError: true,
      content: [{ type: 'text' as const, text: 'Invalid dashboard ID' }],
    };
  }

  const parsed = updateDashboardBodySchema.safeParse({
    name,
    tiles: inputTiles,
    tags,
    containers,
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

  const { tiles, filters, containers: parsedContainers } = parsed.data;
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
    { tiles: 1, filters: 1, containers: 1 },
  ).lean();

  if (!existingDashboard) {
    return {
      isError: true,
      content: [{ type: 'text' as const, text: 'Dashboard not found' }],
    };
  }

  // Mirror the v2 router PUT handler: resolve tile container/tab refs
  // against an effective container set so a payload that omits the
  // `containers` field falls back to the persisted dashboard rather
  // than an empty fallback. Otherwise a tile pointing at a preserved
  // container would be rejected with "Tile references unknown
  // containerId".
  const effectiveContainers =
    parsedContainers ?? existingDashboard.containers ?? [];
  const tileRefIssues = collectTileContainerRefIssues(
    effectiveContainers,
    tilesWithId,
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

  const existingTileIds = new Set(
    (existingDashboard.tiles ?? []).map((t: { id: string }) => t.id),
  );
  const existingFilterIds = new Set(
    (existingDashboard.filters ?? []).map((f: { id: string }) => f.id),
  );

  const internalTiles = convertExternalTilesToInternal(
    tilesWithId,
    existingTileIds,
  );

  const setPayload: Record<string, unknown> = {
    name,
    tiles: internalTiles,
    tags: tags && uniq(tags),
  };

  if (filters !== undefined) {
    setPayload.filters = convertExternalFiltersToInternal(
      filters,
      existingFilterIds,
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

  if (parsedContainers !== undefined) {
    setPayload.containers = parsedContainers;
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

  await cleanupDashboardAlerts({
    dashboardId,
    teamId,
    internalTiles,
    existingTileIds,
  });

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
