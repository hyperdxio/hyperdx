import { isPromqlSavedChartConfig } from '@hyperdx/common-utils/dist/guards';
import type { DashboardContainer } from '@hyperdx/common-utils/dist/types';
import { uniq } from 'lodash';
import mongoose from 'mongoose';
import { z } from 'zod';

import * as config from '@/config';
import { recordDashboardOnboardingIfHasTiles } from '@/controllers/dashboard';
import { UPSERT_TOOL } from '@/mcp/tools/annotations';
import type { ToolRegistrar } from '@/mcp/tools/types';
import { formatZodIssues, mcpUserError } from '@/mcp/utils/errors';
import Dashboard, { IDashboard } from '@/models/dashboard';
import {
  cleanupDashboardAlerts,
  convertExternalFiltersToInternal,
  convertExternalTilesToInternal,
  convertToExternalDashboard,
  createDashboardBodySchema,
  resolveSavedQueryLanguage,
  updateDashboardBodySchema,
  validateDashboardTiles,
} from '@/routers/external-api/v2/utils/dashboards';
import type { ExternalDashboardTileWithId } from '@/utils/zod';
import { objectIdSchema, tagsSchema } from '@/utils/zod';

import type { McpDashboardFilter } from './schemas';
import { mcpContainersParam, mcpFiltersParam, mcpTilesParam } from './schemas';
import {
  getFilterVariableWarnings,
  getRawSqlMissingSourceError,
  getRawSqlTileMacroWarnings,
  getTileVariableWarnings,
} from './validation';
import { withResolvedFilterVariableNames } from './variables';

export function registerSaveDashboard({
  context,
  registerTool,
}: ToolRegistrar): void {
  const { teamId, userId } = context;
  const frontendUrl = config.FRONTEND_URL;

  registerTool(
    'clickstack_save_dashboard',
    {
      title: 'Create or Update Dashboard',
      annotations: UPSERT_TOOL,
      description:
        'Create a new dashboard (omit id) or update an existing one (provide id). ' +
        'Call clickstack_list_sources first to obtain sourceId and connectionId values. ' +
        'IMPORTANT: After saving a dashboard, always run clickstack_query_tiles to validate ' +
        'every tile in one call (or clickstack_query_tile for a single tile) and confirm the ' +
        'queries work and return expected data. Tiles can silently fail ' +
        'due to incorrect filter syntax, missing attributes, or wrong column names. ' +
        'TIP: To update a single tile without resubmitting all tiles, use clickstack_patch_dashboard instead.',
      inputSchema: z.object({
        id: objectIdSchema
          .optional()
          .describe(
            'Dashboard ID. Omit to create a new dashboard, provide to update an existing one.',
          ),
        name: z.string().describe('Dashboard name'),
        tiles: mcpTilesParam,
        tags: tagsSchema.describe(
          'Labels for organizing the dashboard; clickstack_search_dashboards can filter by them.',
        ),
        containers: mcpContainersParam.optional(),
        filters: mcpFiltersParam.optional(),
      }),
    },
    async ({
      id: dashboardId,
      name,
      tiles: inputTiles,
      tags,
      containers,
      filters: inputFilters,
    }) => {
      if (!dashboardId) {
        return createDashboard({
          teamId,
          userId,
          frontendUrl,
          name,
          inputTiles,
          tags,
          containers,
          inputFilters,
        });
      }
      return updateDashboard({
        teamId,
        userId,
        frontendUrl,
        dashboardId,
        name,
        inputTiles,
        tags,
        containers,
        inputFilters,
      });
    },
  );
}

// ─── Create helper ────────────────────────────────────────────────────────────

// The MCP input schema marks filter `id` as optional so the same shape
// serves both create (no id, generated on save) and update (preserved
// id) flows. The underlying body schemas are stricter: create uses
// `externalDashboardFilterSchema` which rejects any `id` field, update
// uses `externalDashboardFilterSchemaWithId` which requires it. Normalize
// the input here so an LLM can copy a filter from the get-dashboard
// response into a create payload (or omit the id on a new filter added
// during update) without hitting a confusing strict-validation rejection.
function stripFilterIds(
  filters: McpDashboardFilter[] | undefined,
): McpDashboardFilter[] | undefined {
  if (!filters) return undefined;
  return filters.map(filter => {
    const { id: _id, ...rest } = filter;
    return rest as McpDashboardFilter;
  });
}

function assignFilterIds(
  filters: McpDashboardFilter[] | undefined,
): McpDashboardFilter[] | undefined {
  if (!filters) return undefined;
  return filters.map(filter =>
    typeof filter.id === 'string' && filter.id.length > 0
      ? filter
      : { ...filter, id: new mongoose.Types.ObjectId().toString() },
  );
}

async function createDashboard({
  teamId,
  userId,
  frontendUrl,
  name,
  inputTiles,
  tags,
  containers,
  inputFilters,
}: {
  teamId: string;
  userId: string | undefined;
  frontendUrl: string | undefined;
  name: string;
  inputTiles: unknown[];
  tags: string[] | undefined;
  containers: DashboardContainer[] | undefined;
  inputFilters: McpDashboardFilter[] | undefined;
}) {
  const parsed = createDashboardBodySchema.safeParse({
    name,
    tiles: inputTiles,
    tags,
    containers,
    filters: stripFilterIds(inputFilters),
  });
  if (!parsed.success) {
    return mcpUserError(`Validation error:\n${formatZodIssues(parsed.error)}`);
  }

  const { tiles, filters, containers: parsedContainers } = parsed.data;
  const tilesWithId = tiles as ExternalDashboardTileWithId[];

  const sqlFilterSourceError = getRawSqlMissingSourceError(tilesWithId);
  if (sqlFilterSourceError) {
    return mcpUserError(sqlFilterSourceError);
  }

  const validationError = await validateDashboardTiles({
    teamId,
    tiles: tilesWithId,
    filters,
    containers: parsedContainers ?? [],
  });
  if (validationError) {
    return mcpUserError(validationError);
  }

  const macroWarnings = [
    ...getRawSqlTileMacroWarnings(tilesWithId),
    ...getTileVariableWarnings(tilesWithId, filters),
    ...getFilterVariableWarnings(filters),
  ];

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

  recordDashboardOnboardingIfHasTiles(userId, newDashboard.tiles);

  const externalDashboard = convertToExternalDashboard(newDashboard, {
    hidePromqlTiles: true,
  });
  return {
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify(
          {
            ...externalDashboard,
            filters: withResolvedFilterVariableNames(
              externalDashboard.filters ?? [],
            ),
            ...(frontendUrl
              ? { url: `${frontendUrl}/dashboards/${newDashboard._id}` }
              : {}),
            hint: 'Use clickstack_query_tiles to validate every tile in one call (or clickstack_query_tile for a single tile) before viewing the dashboard.',
            ...(macroWarnings.length > 0 ? { warnings: macroWarnings } : {}),
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
  userId,
  frontendUrl,
  dashboardId,
  name,
  inputTiles,
  tags,
  containers,
  inputFilters,
}: {
  teamId: string;
  userId: string | undefined;
  frontendUrl: string | undefined;
  dashboardId: string;
  name: string;
  inputTiles: unknown[];
  tags: string[] | undefined;
  containers: DashboardContainer[] | undefined;
  inputFilters: McpDashboardFilter[] | undefined;
}) {
  const parsed = updateDashboardBodySchema.safeParse({
    name,
    tiles: inputTiles,
    tags,
    containers,
    filters: assignFilterIds(inputFilters),
  });
  if (!parsed.success) {
    return mcpUserError(`Validation error:\n${formatZodIssues(parsed.error)}`);
  }

  const { tiles, filters, containers: parsedContainers } = parsed.data;
  const tilesWithId = tiles as ExternalDashboardTileWithId[];

  const sqlFilterSourceError = getRawSqlMissingSourceError(tilesWithId);
  if (sqlFilterSourceError) {
    return mcpUserError(sqlFilterSourceError);
  }

  const existingDashboard = await Dashboard.findOne(
    { _id: dashboardId, team: teamId },
    { tiles: 1, filters: 1, containers: 1 },
  ).lean();

  if (!existingDashboard) {
    return mcpUserError('Dashboard not found');
  }

  const effectiveContainers =
    parsedContainers ?? existingDashboard.containers ?? [];
  const validationError = await validateDashboardTiles({
    teamId,
    tiles: tilesWithId,
    filters,
    existingTiles: existingDashboard.tiles ?? [],
    containers: effectiveContainers,
  });
  if (validationError) {
    return mcpUserError(validationError);
  }

  // An omitted `filters` preserves the persisted set rather than clearing it
  // (see the `$set` below), so the variable checks have to run against those.
  const effectiveFilters = filters ?? existingDashboard.filters;
  const macroWarnings = [
    ...getRawSqlTileMacroWarnings(tilesWithId),
    ...getTileVariableWarnings(tilesWithId, effectiveFilters),
    // Only report on filters this call actually wrote: re-warning about a
    // persisted dependent filter the agent did not touch is noise it cannot
    // act on from a tiles-only update.
    ...getFilterVariableWarnings(filters),
  ];

  const existingTileIds = new Set(
    (existingDashboard.tiles ?? []).map((t: { id: string }) => t.id),
  );
  const existingFilterIds = new Set(
    (existingDashboard.filters ?? []).map((f: { id: string }) => f.id),
  );

  const requestTiles = convertExternalTilesToInternal(
    tilesWithId,
    existingTileIds,
  );
  // MCP reads hide PromQL tiles, so the agent's tile list never contains them.
  // Keep them rather than delete tiles it could not see. A request tile that
  // reuses a hidden tile's id replaces it. Remove with HDX-5302.
  const requestTileIds = new Set(requestTiles.map(tile => tile.id));
  const internalTiles = [
    ...requestTiles,
    ...(existingDashboard.tiles ?? []).filter(
      tile =>
        isPromqlSavedChartConfig(tile.config) && !requestTileIds.has(tile.id),
    ),
  ];

  // Typed as `Partial<IDashboard>` (the canonical Mongo doc shape) so
  // misnamed or wrong-shape fields fail at compile time, mirroring the
  // v2 PUT handler's tightening at
  // `routers/external-api/v2/dashboards.ts:2015`.
  const setPayload: Partial<IDashboard> = {
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
    return mcpUserError('Dashboard not found');
  }

  await cleanupDashboardAlerts({
    dashboardId,
    teamId,
    internalTiles,
    existingTileIds,
  });

  recordDashboardOnboardingIfHasTiles(userId, updatedDashboard.tiles);

  const externalDashboard = convertToExternalDashboard(updatedDashboard, {
    hidePromqlTiles: true,
  });
  return {
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify(
          {
            ...externalDashboard,
            filters: withResolvedFilterVariableNames(
              externalDashboard.filters ?? [],
            ),
            ...(frontendUrl
              ? { url: `${frontendUrl}/dashboards/${updatedDashboard._id}` }
              : {}),
            hint: 'Use clickstack_query_tiles to validate every tile in one call (or clickstack_query_tile for a single tile) before viewing the dashboard.',
            ...(macroWarnings.length > 0 ? { warnings: macroWarnings } : {}),
          },
          null,
          2,
        ),
      },
    ],
  };
}
