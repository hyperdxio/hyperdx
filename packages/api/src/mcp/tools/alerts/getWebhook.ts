import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import Webhook from '@/models/webhook';

import { withToolTracing } from '../../utils/tracing';
import type { McpContext } from '../types';

export function registerGetWebhook(
  server: McpServer,
  context: McpContext,
): void {
  const { teamId } = context;

  server.registerTool(
    'hyperdx_get_webhook',
    {
      title: 'List Webhooks',
      description:
        'List available webhook destinations (id, name, service type). ' +
        'Use the returned id as the webhookId when creating alerts with ' +
        'hyperdx_save_alert.',
      inputSchema: z.object({}),
    },
    withToolTracing('hyperdx_get_webhook', context, async () => {
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
    }),
  );
}
