import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { uniq } from 'lodash';
import mongoose from 'mongoose';
import { z } from 'zod';

import * as config from '@/config';
import Dashboard from '@/models/dashboard';
import {
  cleanupDashboardAlerts,
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
        'due to incorrect filter syntax, missing attributes, or wrong column names.\n\n' +
        'LINKED DASHBOARDS (drill-downs):\n' +
        'Table tiles can declare an `onClick` config that navigates the user from a ' +
        "clicked row to another dashboard or the search page, with the row's column " +
        'values threaded through Handlebars templates (e.g. `{{ServiceName}}`). Use ' +
        'this to build multi-level flows — an overview dashboard that drills into ' +
        'per-entity detail dashboards.\n\n' +
        'Recipe for creating a set of linked dashboards in one session:\n' +
        '  1. Create the LEAF (detail) dashboards first. These should declare the ' +
        '     `filters` they expect to receive (e.g. a `ServiceName` filter), since ' +
        "     the parent's onClick will drive those filter expressions.\n" +
        '  2. Create the PARENT (overview) dashboard with table tiles whose ' +
        '     `onClick` points at the leaf dashboards. The target shape is the ' +
        '     same for both dashboard and search onClicks:\n' +
        '       - `{ mode: "id", id: "<ObjectId>" }` — precise, use when you have ' +
        '         the returned id from step 1 (dashboard) or from ' +
        '         hyperdx_list_sources (source).\n' +
        '       - `{ mode: "template", template: "<Handlebars>" }` — rendered ' +
        '         per row; for dashboard onClicks the rendered value must match ' +
        '         the EXACT name of one dashboard on the team, and for search ' +
        '         onClicks it resolves to a source id or case-insensitive name.\n' +
        '  3. Populate `filterValueTemplates` with one entry per filter value to ' +
        '     forward. Each entry is `{ filter: "<column/expression>", ' +
        '     template: "{{ColumnName}}" }`. Values are SQL-escaped automatically.\n' +
        '  4. Alternatively use `whereTemplate` for free-form SQL/Lucene conditions ' +
        '     (not auto-escaped — prefer filterValueTemplates for row values).\n\n' +
        'Supported Handlebars helpers: `int` (round to integer), `default`, `eq` ' +
        '(block), `json`, `encodeURIComponent`. Built-in helpers (#if, #each, #with, ' +
        'lookup, etc.) are disabled. Strict mode is on: referencing a column the row ' +
        'does not have aborts navigation with a toast error.',
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
