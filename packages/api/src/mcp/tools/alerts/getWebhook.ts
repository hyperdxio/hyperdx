import { z } from 'zod';

import type { ToolRegistrar } from '@/mcp/tools/types';
import Webhook from '@/models/webhook';

export function registerGetWebhook({
  context,
  registerTool,
}: ToolRegistrar): void {
  const { teamId } = context;

  registerTool(
    'clickstack_get_webhook',
    {
      title: 'List Webhooks',
      description:
        'List available webhook destinations (id, name, service type). ' +
        'Use the returned id as the webhookId when creating alerts with ' +
        'clickstack_save_alert.',
      inputSchema: z.object({}),
    },
    async () => {
      const webhooks = await Webhook.find({ team: teamId });

      const output = webhooks.map(wh => ({
        id: wh._id.toString(),
        name: wh.name,
        service: wh.service,
      }));

      return {
        content: [
          { type: 'text' as const, text: JSON.stringify(output, null, 2) },
        ],
      };
    },
  );
}
