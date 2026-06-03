import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import Dashboard from '@/models/dashboard';
import { convertToExternalDashboard } from '@/routers/external-api/v2/utils/dashboards';
import { objectIdSchema } from '@/utils/zod';

import { withToolTracing } from '../../utils/tracing';
import type { McpContext } from '../types';

export function registerGetDashboardTile(
  server: McpServer,
  context: McpContext,
): void {
  const { teamId } = context;

  server.registerTool(
    'clickstack_get_dashboard_tile',
    {
      title: 'Get a Single Dashboard Tile',
      description:
        'Retrieve a single tile from a dashboard by tileId. ' +
        'Useful for inspecting one tile without loading the full dashboard. ' +
        'Use clickstack_get_dashboard (without an ID) to list dashboards, ' +
        'then clickstack_get_dashboard (with an ID) to see all tile IDs.',
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
    withToolTracing(
      'clickstack_get_dashboard_tile',
      context,
      async ({ dashboardId, tileId }) => {
        const dashboard = await Dashboard.findOne({
          _id: dashboardId,
          team: teamId,
        });
        if (!dashboard) {
          return {
            isError: true,
            content: [{ type: 'text' as const, text: 'Dashboard not found' }],
          };
        }

        const externalDashboard = convertToExternalDashboard(dashboard);
        const tile = externalDashboard.tiles.find(t => t.id === tileId);
        if (!tile) {
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

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(tile, null, 2),
            },
          ],
        };
      },
    ),
  );
}
