import * as config from '@/config';
import {
  createSavedSearch,
  getSavedSearch,
  updateSavedSearch,
} from '@/controllers/savedSearch';
import { getSource } from '@/controllers/sources';
import type { ToolRegistrar } from '@/mcp/tools/types';
import {
  mcpServerError,
  mcpUserError,
  validateObjectId,
} from '@/mcp/utils/errors';

import { mcpSaveSavedSearchSchema } from './schemas';

export function registerSaveSavedSearch({
  context,
  registerTool,
}: ToolRegistrar): void {
  const { teamId, userId } = context;
  const frontendUrl = config.FRONTEND_URL;

  registerTool(
    'clickstack_save_saved_search',
    {
      title: 'Create or Update Saved Search',
      description:
        'Create a new saved search (omit id) or update an existing one (provide id). ' +
        'A saved search stores a reusable query against a data source. ' +
        'Use clickstack_list_sources to find the sourceId.',
      inputSchema: mcpSaveSavedSearchSchema,
    },
    async input => {
      const isUpdate = !!input.id;

      // ── Validate ID for updates ──
      if (isUpdate) {
        const idError = validateObjectId(input.id!, 'saved search ID');
        if (idError) return idError;
      }

      // ── Validate sourceId (format validated by Zod schema, check existence) ──
      const source = await getSource(teamId, input.sourceId);
      if (!source) {
        return mcpUserError('Source not found');
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
          return mcpUserError('Saved search not found');
        }

        const updated = await updateSavedSearch(
          teamId,
          input.id!,
          savedSearchData,
          userId,
        );

        if (!updated) {
          return mcpServerError('Failed to update saved search');
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
    },
  );
}
