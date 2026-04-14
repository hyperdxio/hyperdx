import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import mongoose from 'mongoose';
import { z } from 'zod';

import Dashboard from '@/models/dashboard';
import { convertToExternalDashboard } from '@/routers/external-api/v2/utils/dashboards';

import { withToolTracing } from '../../utils/tracing';
import { parseTimeRange, runConfigTile } from '../query/helpers';
import type { McpContext } from '../types';

export function registerQueryTile(
  server: McpServer,
  context: McpContext,
): void {
  const { teamId } = context;

  server.registerTool(
    'hyperdx_query_tile',
    {
      title: 'Query a Dashboard Tile',
      description:
        'Execute the query for a specific tile on an existing dashboard. ' +
        'Useful for validating that a tile returns data or for spot-checking results ' +
        'without rebuilding the query from scratch. ' +
        'Use hyperdx_get_dashboard with an ID to find tile IDs.',
      inputSchema: z.object({
        dashboardId: z.string().describe('Dashboard ID.'),
        tileId: z
          .string()
          .describe(
            'Tile ID within the dashboard. ' +
              'Obtain from hyperdx_get_dashboard.',
          ),
        startTime: z
          .string()
          .optional()
          .describe(
            'Start of the query window as ISO 8601. Default: 15 minutes ago. ' +
              'If results are empty, try a wider range (e.g. 24 hours).',
          ),
        endTime: z
          .string()
          .optional()
          .describe('End of the query window as ISO 8601. Default: now.'),
      }),
    },
    withToolTracing(
      'hyperdx_query_tile',
      context,
      async ({ dashboardId, tileId, startTime, endTime }) => {
        const timeRange = parseTimeRange(startTime, endTime);
        if ('error' in timeRange) {
          return {
            isError: true,
            content: [{ type: 'text' as const, text: timeRange.error }],
          };
        }
        const { startDate, endDate } = timeRange;

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
                text: `Tile not found: ${tileId}. Available tile IDs: ${externalDashboard.tiles.map(t => t.id).join(', ')}`,
              },
            ],
          };
        }

        return runConfigTile(teamId.toString(), tile, startDate, endDate);
      },
    ),
  );
}
