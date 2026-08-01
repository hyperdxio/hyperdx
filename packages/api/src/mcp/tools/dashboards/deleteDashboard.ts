import mongoose from 'mongoose';
import { z } from 'zod';

import { deleteDashboard } from '@/controllers/dashboard';
import type { ToolRegistrar } from '@/mcp/tools/types';
import { mcpUserError } from '@/mcp/utils/errors';
import Dashboard from '@/models/dashboard';
import { objectIdSchema } from '@/utils/zod';

export function registerDeleteDashboard({
  context,
  registerTool,
}: ToolRegistrar): void {
  const { teamId } = context;

  registerTool(
    'clickstack_delete_dashboard',
    {
      title: 'Delete Dashboard',
      description:
        'Permanently delete a dashboard by ID. Also removes any alerts attached to its tiles. ' +
        'Use clickstack_get_dashboard (without an ID) to list available dashboard IDs.',
      inputSchema: z.object({
        id: objectIdSchema.describe('Dashboard ID to delete.'),
      }),
    },
    async ({ id: dashboardId }) => {
      const existing = await Dashboard.findOne({
        _id: dashboardId,
        team: teamId,
      }).lean();
      if (!existing) {
        return mcpUserError('Dashboard not found');
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
  );
}
