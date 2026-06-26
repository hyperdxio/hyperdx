import type { DashboardContainer } from '@hyperdx/common-utils/dist/types';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { uniq } from 'lodash';
import mongoose from 'mongoose';
import { z } from 'zod';

import * as config from '@/config';
import type { McpContext } from '@/mcp/tools/types';
import { mcpError } from '@/mcp/utils/errors';
import { withToolTracing } from '@/mcp/utils/tracing';
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
import {
  type ExternalDashboardFilter,
  type ExternalDashboardFilterWithId,
  type ExternalDashboardSavedFilterValue,
  externalDashboardSavedFilterValueSchema,
  type ExternalDashboardTileWithId,
} from '@/utils/zod';
import { objectIdSchema } from '@/utils/zod';

import { mcpContainersParam, mcpFiltersParam, mcpTilesParam } from './schemas';
import {
  getRawSqlMissingSourceError,
  getRawSqlTileMacroWarnings,
} from './validation';

export function registerSaveDashboard(
  server: McpServer,
  context: McpContext,
): void {
  const { teamId } = context;
  const frontendUrl = config.FRONTEND_URL;

  server.registerTool(
    'clickstack_save_dashboard',
    {
      title: 'Create or Update Dashboard',
      description:
        'Create a new dashboard (omit id) or update an existing one (provide id). ' +
        'Call clickstack_list_sources first to obtain sourceId and connectionId values. ' +
        'IMPORTANT: After saving a dashboard, always run clickstack_query_tile on each tile ' +
        'to confirm the queries work and return expected data. Tiles can silently fail ' +
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
        tags: z.array(z.string()).optional().describe('Dashboard tags'),
        containers: mcpContainersParam.optional(),
        filters: mcpFiltersParam.optional(),
        savedFilterValues: z
          .array(externalDashboardSavedFilterValueSchema)
          .optional()
          .describe(
            'Optional saved default values for the dashboard filters. Each ' +
              'entry is a Lucene or SQL `condition` string keyed by a filter ' +
              'expression (e.g. `ServiceName:"hdx-private-api"`). ' +
              'Pair this with `constant: true` on a filter in the `filters` ' +
              'array to lock that filter to a specific value: the matching ' +
              'savedFilterValues entry is applied automatically on every ' +
              'tile and the viewer cannot override it. ' +
              'If you set `constant: true` without a corresponding ' +
              'savedFilterValues entry, the filter has no effect. ' +
              'On UPDATE, this array is overwritten as a whole: drop any ' +
              'entries for filter expressions you removed from the `filters` ' +
              'array so they do not stay as orphaned scope locks.',
          ),
      }),
    },
    withToolTracing(
      'clickstack_save_dashboard',
      context,
      async ({
        id: dashboardId,
        name,
        tiles: inputTiles,
        tags,
        containers,
        filters: inputFilters,
        savedFilterValues: inputSavedFilterValues,
      }) => {
        if (!dashboardId) {
          return createDashboard({
            teamId,
            frontendUrl,
            name,
            inputTiles,
            tags,
            containers,
            inputFilters,
            inputSavedFilterValues,
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
          inputFilters,
          inputSavedFilterValues,
        });
      },
    ),
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
  filters:
    | (ExternalDashboardFilter | ExternalDashboardFilterWithId)[]
    | undefined,
): ExternalDashboardFilter[] | undefined {
  if (!filters) return undefined;
  return filters.map(filter => {
    const { id: _id, ...rest } = filter as ExternalDashboardFilterWithId;
    return rest as ExternalDashboardFilter;
  });
}

function assignFilterIds(
  filters:
    | (ExternalDashboardFilter | ExternalDashboardFilterWithId)[]
    | undefined,
): ExternalDashboardFilterWithId[] | undefined {
  if (!filters) return undefined;
  return filters.map(filter => {
    const withId = filter as ExternalDashboardFilterWithId;
    if (typeof withId.id === 'string' && withId.id.length > 0) return withId;
    return {
      ...filter,
      id: new mongoose.Types.ObjectId().toString(),
    } as ExternalDashboardFilterWithId;
  });
}

async function createDashboard({
  teamId,
  frontendUrl,
  name,
  inputTiles,
  tags,
  containers,
  inputFilters,
  inputSavedFilterValues,
}: {
  teamId: string;
  frontendUrl: string | undefined;
  name: string;
  inputTiles: unknown[];
  tags: string[] | undefined;
  containers: DashboardContainer[] | undefined;
  inputFilters:
    | (ExternalDashboardFilter | ExternalDashboardFilterWithId)[]
    | undefined;
  inputSavedFilterValues: ExternalDashboardSavedFilterValue[] | undefined;
}) {
  const parsed = createDashboardBodySchema.safeParse({
    name,
    tiles: inputTiles,
    tags,
    containers,
    filters: stripFilterIds(inputFilters),
    savedFilterValues: inputSavedFilterValues,
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

  const sqlFilterSourceError = getRawSqlMissingSourceError(tilesWithId);
  if (sqlFilterSourceError) {
    return mcpError(sqlFilterSourceError);
  }

  const validationError = await validateDashboardTiles({
    teamId,
    tiles: tilesWithId,
    filters,
    containers: parsedContainers ?? [],
  });
  if (validationError) {
    return {
      isError: true,
      content: [{ type: 'text' as const, text: validationError }],
    };
  }

  const macroWarnings = getRawSqlTileMacroWarnings(tilesWithId);

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
            hint: 'Use clickstack_query_tile to test individual tile queries before viewing the dashboard.',
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
  frontendUrl,
  dashboardId,
  name,
  inputTiles,
  tags,
  containers,
  inputFilters,
  inputSavedFilterValues,
}: {
  teamId: string;
  frontendUrl: string | undefined;
  dashboardId: string;
  name: string;
  inputTiles: unknown[];
  tags: string[] | undefined;
  containers: DashboardContainer[] | undefined;
  inputFilters:
    | (ExternalDashboardFilter | ExternalDashboardFilterWithId)[]
    | undefined;
  inputSavedFilterValues: ExternalDashboardSavedFilterValue[] | undefined;
}) {
  const parsed = updateDashboardBodySchema.safeParse({
    name,
    tiles: inputTiles,
    tags,
    containers,
    filters: assignFilterIds(inputFilters),
    savedFilterValues: inputSavedFilterValues,
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

  const sqlFilterSourceError = getRawSqlMissingSourceError(tilesWithId);
  if (sqlFilterSourceError) {
    return mcpError(sqlFilterSourceError);
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
    return {
      isError: true,
      content: [{ type: 'text' as const, text: validationError }],
    };
  }

  const macroWarnings = getRawSqlTileMacroWarnings(tilesWithId);

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
            hint: 'Use clickstack_query_tile to test individual tile queries before viewing the dashboard.',
            ...(macroWarnings.length > 0 ? { warnings: macroWarnings } : {}),
          },
          null,
          2,
        ),
      },
    ],
  };
}
