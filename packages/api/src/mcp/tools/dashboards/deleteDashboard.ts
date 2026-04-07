import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import mongoose from 'mongoose';
import { z } from 'zod/v4';

import { deleteDashboard } from '@/controllers/dashboard';
import Dashboard from '@/models/dashboard';

import { withToolTracing } from '../../utils/tracing';
import type { McpContext } from '../types';

export function registerDeleteDashboard(
  server: McpServer,
  context: McpContext,
): void {
  const { teamId } = context;

  server.registerTool(
    'hyperdx_delete_dashboard',
    {
      title: 'Delete Dashboard',
      description:
        'Permanently delete a dashboard by ID. Also removes any alerts attached to its tiles. ' +
        'Use hyperdx_get_dashboard (without an ID) to list available dashboard IDs.',
      inputSchema: z.object({
        id: z.string().describe('Dashboard ID to delete.'),
      }),
    },
    withToolTracing(
      'hyperdx_delete_dashboard',
      context,
      async ({ id: dashboardId }) => {
        const existing = await Dashboard.findOne({
          _id: dashboardId,
          team: teamId,
        }).lean();
        if (!existing) {
          return {
            isError: true,
            content: [{ type: 'text' as const, text: 'Dashboard not found' }],
          };
        }

        await deleteDashboard(dashboardId, new mongoose.Types.ObjectId(teamId));

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({ deleted: true, id: dashboardId }, null, 2),
            },
          ],
        };
      },
    ),
  );
}
