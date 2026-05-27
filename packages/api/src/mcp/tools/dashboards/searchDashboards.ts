import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import * as config from '@/config';
import Dashboard from '@/models/dashboard';

import { withToolTracing } from '../../utils/tracing';
import type { McpContext } from '../types';

/** Escape regex metacharacters so user input is treated as a literal substring. */
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function registerSearchDashboards(
  server: McpServer,
  context: McpContext,
): void {
  const { teamId } = context;
  const frontendUrl = config.FRONTEND_URL;

  server.registerTool(
    'hyperdx_search_dashboards',
    {
      title: 'Search Dashboards',
      description:
        'Search dashboards by name and/or tags. Returns matching dashboards with ' +
        'their IDs, names, and tags. More targeted than hyperdx_get_dashboard (which ' +
        'lists all dashboards). At least one of query or tags must be provided.',
      inputSchema: z.object({
        query: z
          .string()
          .max(200)
          .optional()
          .describe(
            'Search term to match against dashboard names (case-insensitive substring match).',
          ),
        tags: z
          .array(z.string())
          .optional()
          .describe('Filter to dashboards that have ALL of these tags.'),
      }),
    },
    withToolTracing(
      'hyperdx_search_dashboards',
      context,
      async ({ query, tags }) => {
        const hasQuery = typeof query === 'string' && query.length > 0;
        const hasTags = Array.isArray(tags) && tags.length > 0;

        if (!hasQuery && !hasTags) {
          return {
            isError: true,
            content: [
              {
                type: 'text' as const,
                text: 'Provide at least one of: query (non-empty string) or tags (non-empty array).',
              },
            ],
          };
        }

        const filter: Record<string, unknown> = { team: teamId };

        if (hasQuery) {
          filter.name = { $regex: escapeRegExp(query!), $options: 'i' };
        }
        if (hasTags) {
          filter.tags = { $all: tags };
        }

        try {
          const dashboards = await Dashboard.find(filter)
            .select({ name: 1, tags: 1 })
            .lean();

          const output = dashboards.map(d => ({
            id: d._id.toString(),
            name: d.name,
            tags: d.tags,
            ...(frontendUrl
              ? { url: `${frontendUrl}/dashboards/${d._id}` }
              : {}),
          }));

          return {
            content: [
              {
                type: 'text' as const,
                text: JSON.stringify(output, null, 2),
              },
            ],
          };
        } catch (err) {
          return {
            isError: true,
            content: [
              {
                type: 'text' as const,
                text: `Search failed: ${err instanceof Error ? err.message : String(err)}`,
              },
            ],
          };
        }
      },
    ),
  );
}
