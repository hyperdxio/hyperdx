import { z } from 'zod';

import { READ_ONLY_TOOL } from '@/mcp/tools/annotations';
import type { ToolRegistrar } from '@/mcp/tools/types';
import { mcpUserError } from '@/mcp/utils/errors';
import Dashboard from '@/models/dashboard';
import { convertToExternalDashboard } from '@/routers/external-api/v2/utils/dashboards';
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
      annotations: READ_ONLY_TOOL,
      description:
        'Retrieve a single tile from a dashboard by tileId. ' +
        'Useful for inspecting one tile without loading the full dashboard. ' +
        'Returns the tile as JSON in the same shape clickstack_get_dashboard uses ' +
        'for tiles: id, name, x, y, w, h, containerId/tabId when set, and config. ' +
        'An unknown tileId returns an error listing the available tile IDs and names. ' +
        'Use clickstack_get_dashboard (without an ID) to list dashboards, ' +
        'then clickstack_get_dashboard (with an ID) to see all tile IDs.',
      inputSchema: z.object({
        dashboardId: objectIdSchema.describe(
          'Dashboard ID, from clickstack_get_dashboard (no id lists dashboards) ' +
            'or clickstack_search_dashboards.',
        ),
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

      const externalDashboard = convertToExternalDashboard(dashboard, {
        hidePromqlTiles: true,
      });
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
            text: JSON.stringify(tile, null, 2),
          },
        ],
      };
    },
  );
}
