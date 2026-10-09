import { z } from 'zod';

import type { ToolRegistrar } from '@/mcp/tools/types';
import { mcpUserError } from '@/mcp/utils/errors';
import Dashboard from '@/models/dashboard';
import { convertToExternalDashboard } from '@/routers/external-api/v2/utils/dashboards';
import { versionToken } from '@/utils/dashboardVersion';
import { objectIdSchema } from '@/utils/zod';

export function registerGetDashboardTile({
  context,
  registerTool,
}: ToolRegistrar): void {
  const { teamId } = context;

  registerTool(
    'clickstack_get_dashboard_tile',
    {
      title: 'Get a Single Dashboard Tile',
      annotations: { readOnlyHint: true },
      description:
        'Retrieve a single tile from a dashboard by tileId. ' +
        'Useful for inspecting one tile without loading the full dashboard. ' +
        'Use clickstack_get_dashboard (without an ID) to list dashboards, ' +
        'then clickstack_get_dashboard (with an ID) to see all tile IDs. ' +
        'Returns `{ dashboardId, dashboardVersion, tile }` — pass ' +
        '`dashboardVersion` back to clickstack_patch_dashboard as its ' +
        '`version` argument so the write is rejected instead of overwriting ' +
        'an edit made since you read.',
      inputSchema: z.object({
        dashboardId: objectIdSchema.describe('Dashboard ID.'),
        tileId: z
          .string()
          .describe(
            'Tile ID within the dashboard. ' +
              'Obtain from clickstack_get_dashboard.',
          ),
      }),
    },
    async ({ dashboardId, tileId }) => {
      const dashboard = await Dashboard.findOne({
        _id: dashboardId,
        team: teamId,
      });
      if (!dashboard) {
        return mcpUserError('Dashboard not found');
      }

      const externalDashboard = convertToExternalDashboard(dashboard);
      const tile = externalDashboard.tiles.find(t => t.id === tileId);
      if (!tile) {
        return mcpUserError(
          `Tile not found: ${tileId}. Available tile IDs: ${externalDashboard.tiles.map(t => `${t.id} (${t.name})`).join(', ')}`,
        );
      }

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(
              {
                dashboardId,
                // Pass to clickstack_patch_dashboard as `version`. Wrapped
                // rather than merged into the tile so the tile object stays
                // exactly what the patch tool's `tile` argument accepts.
                dashboardVersion: versionToken(dashboard),
                tile,
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
