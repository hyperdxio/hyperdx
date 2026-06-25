import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import mongoose from 'mongoose';
import { z } from 'zod';

import * as config from '@/config';
import { getDashboards } from '@/controllers/dashboard';
import type { McpContext } from '@/mcp/tools/types';
import { validateObjectId } from '@/mcp/utils/errors';
import { withToolTracing } from '@/mcp/utils/tracing';
import Dashboard from '@/models/dashboard';
import { convertToExternalDashboard } from '@/routers/external-api/v2/utils/dashboards';

export function registerGetDashboard(
  server: McpServer,
  context: McpContext,
): void {
  const { teamId } = context;
  const frontendUrl = config.FRONTEND_URL;

  server.registerTool(
    'clickstack_get_dashboard',
    {
      title: 'Get Dashboard(s)',
      description:
        'Without an ID: list all dashboards (returns IDs, names, tags). ' +
        'With an ID: get full dashboard detail including all tiles and configuration.',
      inputSchema: z.object({
        id: z
          .string()
          .optional()
          .describe(
            'Dashboard ID. Omit to list all dashboards, provide to get full detail.',
          ),
      }),
    },
    withToolTracing('clickstack_get_dashboard', context, async ({ id }) => {
      if (!id) {
        const dashboards = await getDashboards(
          new mongoose.Types.ObjectId(teamId),
        );
        const output = dashboards.map(d => ({
          id: d._id.toString(),
          name: d.name,
          tags: d.tags,
          ...(frontendUrl ? { url: `${frontendUrl}/dashboards/${d._id}` } : {}),
        }));
        return {
          content: [
            { type: 'text' as const, text: JSON.stringify(output, null, 2) },
          ],
        };
      }

      const idError = validateObjectId(id, 'dashboard ID');
      if (idError) return idError;

      const dashboard = await Dashboard.findOne({ _id: id, team: teamId });
      if (!dashboard) {
        return {
          isError: true,
          content: [{ type: 'text' as const, text: 'Dashboard not found' }],
        };
      }
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(
              {
                ...convertToExternalDashboard(dashboard),
                ...(frontendUrl
                  ? { url: `${frontendUrl}/dashboards/${dashboard._id}` }
                  : {}),
              },
              null,
              2,
            ),
          },
        ],
      };
    }),
  );
}
