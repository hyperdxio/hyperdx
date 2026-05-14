import { type AlertInterval } from '@hyperdx/common-utils/dist/types';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ObjectId } from 'mongodb';
import mongoose from 'mongoose';
import { z } from 'zod';

import * as config from '@/config';
import { getRecentAlertHistories } from '@/controllers/alertHistory';
import { getAlertById } from '@/controllers/alerts';
import Alert from '@/models/alert';
import { translateAlertDocumentToExternalAlert } from '@/utils/externalApi';

import { withToolTracing } from '../../utils/tracing';
import type { McpContext } from '../types';

export function registerGetAlert(server: McpServer, context: McpContext): void {
  const { teamId } = context;
  const frontendUrl = config.FRONTEND_URL;

  server.registerTool(
    'hyperdx_get_alert',
    {
      title: 'Get Alert(s)',
      description:
        'Without an ID: list all alerts as a high-level summary ' +
        '(id, name, state, source, interval). Optionally filter by state ' +
        '(e.g. state="ALERT" for firing alerts). ' +
        'With an ID: get full alert detail including configuration and ' +
        'recent evaluation history.',
      inputSchema: z.object({
        id: z
          .string()
          .optional()
          .describe(
            'Alert ID. Omit to list all alerts, provide to get full detail.',
          ),
        state: z
          .enum(['ALERT', 'OK', 'DISABLED', 'INSUFFICIENT_DATA'])
          .optional()
          .describe(
            'Filter list by alert state (only applies when id is omitted). ' +
              'Use "ALERT" to find currently firing alerts.',
          ),
      }),
    },
    withToolTracing('hyperdx_get_alert', context, async ({ id, state }) => {
      // ── List all alerts (slim summary) ──
      if (!id) {
        const query: Record<string, unknown> = {
          team: new mongoose.Types.ObjectId(teamId),
        };
        if (state) {
          query.state = state;
        }
        const alerts = await Alert.find(query);

        const output = alerts.map(alert => ({
          id: alert._id.toString(),
          name: alert.name,
          state: alert.state,
          source: alert.source,
          interval: alert.interval,
          ...(frontendUrl ? { url: `${frontendUrl}/alerts` } : {}),
        }));
        return {
          content: [
            { type: 'text' as const, text: JSON.stringify(output, null, 2) },
          ],
        };
      }

      // ── Get single alert (full detail) ──
      if (!mongoose.Types.ObjectId.isValid(id)) {
        return {
          isError: true,
          content: [{ type: 'text' as const, text: 'Invalid alert ID' }],
        };
      }

      const alert = await getAlertById(id, teamId);
      if (!alert) {
        return {
          isError: true,
          content: [{ type: 'text' as const, text: 'Alert not found' }],
        };
      }

      const history = await getRecentAlertHistories({
        alertId: new ObjectId(alert._id),
        interval: alert.interval as AlertInterval,
        limit: 20,
      });

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(
              {
                ...translateAlertDocumentToExternalAlert(alert),
                history,
                ...(frontendUrl ? { url: `${frontendUrl}/alerts` } : {}),
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
