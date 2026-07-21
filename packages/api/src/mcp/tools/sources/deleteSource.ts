import { z } from 'zod';

import { deleteSource } from '@/controllers/sources';
import type { ToolRegistrar } from '@/mcp/tools/types';
import { mcpUserError } from '@/mcp/utils/errors';
import { objectIdSchema } from '@/utils/zod';

export function registerDeleteSource({
  context,
  registerTool,
}: ToolRegistrar): void {
  const { teamId } = context;

  registerTool(
    'clickstack_delete_source',
    {
      title: 'Delete Source',
      description:
        'Permanently delete a data source by ID. Other sources may reference ' +
        'it (e.g. a trace source linked to a log source) — those links are ' +
        'left dangling, so check dependencies first. Use clickstack_list_sources ' +
        'to find available source IDs.',
      inputSchema: z.object({
        id: objectIdSchema.describe('Source ID to delete.'),
      }),
    },
    async ({ id: sourceId }) => {
      // deleteSource is team-scoped and returns the deleted document (or null
      // if no matching source exists for this team), so its return value is the
      // authoritative success signal — keying off a separate getSource
      // pre-check would report deleted:true even when a concurrent delete
      // removed the row first.
      const deleted = await deleteSource(teamId, sourceId);
      if (!deleted) {
        return mcpUserError('Source not found');
      }

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({ deleted: true, id: sourceId }, null, 2),
          },
        ],
      };
    },
  );
}
