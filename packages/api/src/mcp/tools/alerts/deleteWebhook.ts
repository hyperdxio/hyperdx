import mongoose from 'mongoose';
import { z } from 'zod';

import { deleteWebhook } from '@/controllers/webhook';
import type { ToolRegistrar } from '@/mcp/tools/types';
import { mcpUserError } from '@/mcp/utils/errors';
import { objectIdSchema } from '@/utils/zod';

export function registerDeleteWebhook({
  context,
  registerTool,
}: ToolRegistrar): void {
  const { teamId } = context;

  registerTool(
    'clickstack_delete_webhook',
    {
      title: 'Delete Webhook',
      description:
        'Permanently delete a webhook by ID. Blocked while any alert still ' +
        'references it — reassign or delete those alerts first. Use ' +
        'clickstack_get_webhook to list available webhook IDs.',
      inputSchema: z.object({
        id: objectIdSchema.describe('Webhook ID to delete.'),
      }),
    },
    async ({ id: webhookId }) => {
      const result = await deleteWebhook(
        new mongoose.Types.ObjectId(teamId),
        webhookId,
      );

      if (result.status === 'referenced') {
        return mcpUserError(
          `Cannot delete webhook: ${result.alertCount} alert(s) still reference it. ` +
            'Reassign or remove those alerts first.',
        );
      }
      if (result.status === 'not_found') {
        return mcpUserError('Webhook not found');
      }

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({ deleted: true, id: webhookId }, null, 2),
          },
        ],
      };
    },
  );
}
