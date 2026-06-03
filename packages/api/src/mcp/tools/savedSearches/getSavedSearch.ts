import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import mongoose from 'mongoose';
import { z } from 'zod';

import * as config from '@/config';
import { getSavedSearch } from '@/controllers/savedSearch';
import { SavedSearch } from '@/models/savedSearch';

import { withToolTracing } from '../../utils/tracing';
import type { McpContext } from '../types';

export function registerGetSavedSearch(
  server: McpServer,
  context: McpContext,
): void {
  const { teamId } = context;
  const frontendUrl = config.FRONTEND_URL;

  server.registerTool(
    'clickstack_get_saved_search',
    {
      title: 'Get Saved Search(es)',
      description:
        'Without an ID: list all saved searches as a high-level summary ' +
        '(id, name, tags). ' +
        'With an ID: get full saved search detail including query, source, ' +
        'filters, and configuration.',
      inputSchema: z.object({
        id: z
          .string()
          .optional()
          .describe(
            'Saved search ID. Omit to list all saved searches, provide to get full detail.',
          ),
      }),
    },
    withToolTracing('clickstack_get_saved_search', context, async ({ id }) => {
      // ── List all saved searches (slim query — only fetch the fields we need) ──
      if (!id) {
        const savedSearches = await SavedSearch.find(
          { team: teamId },
          'name tags',
        ).lean();
        const output = savedSearches.map(ss => ({
          id: ss._id.toString(),
          name: ss.name,
          tags: ss.tags,
          ...(frontendUrl ? { url: `${frontendUrl}/search/${ss._id}` } : {}),
        }));
        return {
          content: [
            { type: 'text' as const, text: JSON.stringify(output, null, 2) },
          ],
        };
      }

      // ── Get single saved search ──
      if (!mongoose.Types.ObjectId.isValid(id)) {
        return {
          isError: true,
          content: [{ type: 'text' as const, text: 'Invalid saved search ID' }],
        };
      }

      const savedSearch = await getSavedSearch(teamId, id);
      if (!savedSearch) {
        return {
          isError: true,
          content: [{ type: 'text' as const, text: 'Saved search not found' }],
        };
      }

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(
              {
                ...savedSearch.toExternalJSON(),
                ...(frontendUrl
                  ? { url: `${frontendUrl}/search/${savedSearch._id}` }
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
