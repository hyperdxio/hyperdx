import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import * as config from '@/config';
import {
  createSavedSearch,
  getSavedSearch,
  updateSavedSearch,
} from '@/controllers/savedSearch';
import { getSource } from '@/controllers/sources';

import { mcpError, validateObjectId } from '../../utils/errors';
import { withToolTracing } from '../../utils/tracing';
import type { McpContext } from '../types';
import { mcpSaveSavedSearchSchema } from './schemas';

export function registerSaveSavedSearch(
  server: McpServer,
  context: McpContext,
): void {
  const { teamId, userId } = context;
  const frontendUrl = config.FRONTEND_URL;

  server.registerTool(
    'clickstack_save_saved_search',
    {
      title: 'Create or Update Saved Search',
      description:
        'Create a new saved search (omit id) or update an existing one (provide id). ' +
        'A saved search stores a reusable query against a data source. ' +
        'Use clickstack_list_sources to find the sourceId.',
      inputSchema: mcpSaveSavedSearchSchema,
    },
    withToolTracing('clickstack_save_saved_search', context, async input => {
      const isUpdate = !!input.id;

      // ── Validate ID for updates ──
      if (isUpdate) {
        const idError = validateObjectId(input.id!, 'saved search ID');
        if (idError) return idError;
      }

      // ── Validate sourceId (format validated by Zod schema, check existence) ──
      const source = await getSource(teamId, input.sourceId);
      if (!source) {
        return mcpError('Source not found');
      }

      // Build the saved search data matching what the controller expects.
      const savedSearchData = {
        name: input.name,
        select: input.select ?? '',
        where: input.where ?? '',
        whereLanguage: input.whereLanguage,
        orderBy: input.orderBy,
        source: input.sourceId,
        tags: input.tags ?? [],
        filters: input.filters,
      };

      if (isUpdate) {
        // Verify the saved search exists before updating.
        const existing = await getSavedSearch(teamId, input.id!);
        if (!existing) {
          return {
            isError: true,
            content: [
              { type: 'text' as const, text: 'Saved search not found' },
            ],
          };
        }

        const updated = await updateSavedSearch(
          teamId,
          input.id!,
          savedSearchData,
          userId,
        );

        if (!updated) {
          return {
            isError: true,
            content: [
              {
                type: 'text' as const,
                text: 'Failed to update saved search',
              },
            ],
          };
        }

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                {
                  ...updated.toExternalJSON(),
                  ...(frontendUrl
                    ? { url: `${frontendUrl}/search/${updated._id}` }
                    : {}),
                },
                null,
                2,
              ),
            },
          ],
        };
      }

      // ── Create ──
      const created = await createSavedSearch(teamId, savedSearchData, userId);

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(
              {
                ...created.toExternalJSON(),
                ...(frontendUrl
                  ? { url: `${frontendUrl}/search/${created._id}` }
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
