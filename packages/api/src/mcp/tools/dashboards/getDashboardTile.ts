import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import mongoose from 'mongoose';
import { z } from 'zod';

import Dashboard from '@/models/dashboard';
import { convertToExternalDashboard } from '@/routers/external-api/v2/utils/dashboards';

import { withToolTracing } from '../../utils/tracing';
import type { McpContext } from '../types';

export function registerGetDashboardTile(
  server: McpServer,
  context: McpContext,
): void {
  const { teamId } = context;

  server.registerTool(
    'hyperdx_get_dashboard_tile',
    {
      title: 'Get a Single Dashboard Tile',
      description:
        'Retrieve a single tile from a dashboard by tileId. ' +
        'Useful for inspecting one tile without loading the full dashboard. ' +
        'Use hyperdx_get_dashboard (without an ID) to list dashboards, ' +
        'then hyperdx_get_dashboard (with an ID) to see all tile IDs.',
      inputSchema: z.object({
        dashboardId: z.string().describe('Dashboard ID.'),
        tileId: z
          .string()
          .describe(
            'Tile ID within the dashboard. ' +
              'Obtain from hyperdx_get_dashboard.',
          ),
      }),
    },
    withToolTracing(
      'hyperdx_get_dashboard_tile',
      context,
      async ({ dashboardId, tileId }) => {
        if (!mongoose.Types.ObjectId.isValid(dashboardId)) {
          return {
            isError: true,
            content: [{ type: 'text' as const, text: 'Invalid dashboard ID' }],
          };
        }

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
