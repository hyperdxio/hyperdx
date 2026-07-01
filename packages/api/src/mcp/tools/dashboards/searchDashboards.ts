import { escapeRegExp } from 'lodash';

import * as config from '@/config';
import type { ToolRegistrar } from '@/mcp/tools/types';
import { mcpUserError } from '@/mcp/utils/errors';
import Dashboard from '@/models/dashboard';
import logger from '@/utils/logger';

import { mcpSearchDashboardsSchema } from './schemas';

const SEARCH_RESULTS_LIMIT = 100;

export function registerSearchDashboards({
  context,
  registerTool,
}: ToolRegistrar): void {
  const { teamId } = context;
  const frontendUrl = config.FRONTEND_URL;

  registerTool(
    'clickstack_search_dashboards',
    {
      title: 'Search Dashboards',
      description:
        'Search dashboards by name and/or tags. Returns matching dashboards with ' +
        'their IDs, names, and tags. More targeted than clickstack_get_dashboard (which ' +
        'lists all dashboards). At least one of query or tags must be provided.',
      inputSchema: mcpSearchDashboardsSchema,
    },
    async ({ query, tags }) => {
      const hasQuery = typeof query === 'string' && query.length > 0;
      const hasTags = Array.isArray(tags) && tags.length > 0;

      if (!hasQuery && !hasTags) {
        return mcpUserError(
          'Provide at least one of: query (non-empty string) or tags (non-empty array).',
        );
      }

      const filter: Record<string, unknown> = { team: teamId };

      if (hasQuery) {
        filter.name = { $regex: escapeRegExp(query), $options: 'i' };
      }
      if (hasTags) {
        filter.tags = { $all: tags };
      }

      try {
        const dashboards = await Dashboard.find(filter)
          .select({ name: 1, tags: 1 })
          .limit(SEARCH_RESULTS_LIMIT + 1)
          .lean();

        const truncated = dashboards.length > SEARCH_RESULTS_LIMIT;
        const results = truncated
          ? dashboards.slice(0, SEARCH_RESULTS_LIMIT)
          : dashboards;

        const output = results.map(d => ({
          id: d._id.toString(),
          name: d.name,
          tags: d.tags,
          ...(frontendUrl ? { url: `${frontendUrl}/dashboards/${d._id}` } : {}),
        }));

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                truncated
                  ? {
                      results: output,
                      truncated: true,
                      hint: `Returned first ${SEARCH_RESULTS_LIMIT} results. Narrow your query or tags to see more.`,
                    }
                  : output,
                null,
                2,
              ),
            },
          ],
        };
      } catch (err) {
        logger.error(
          { err, teamId, query, tags },
          'clickstack_search_dashboards: query failed',
        );
        return mcpUserError(
          `Search failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    },
  );
}
