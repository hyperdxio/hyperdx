import { AlertThresholdType } from '@hyperdx/common-utils/dist/types';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import mongoose from 'mongoose';

import * as config from '@/config';
import {
  type AlertInput,
  createAlert,
  updateAlert,
  validateAlertInput,
} from '@/controllers/alerts';
import { type AlertChannel, AlertSource } from '@/models/alert';
import { BaseError } from '@/utils/errors';
import { translateAlertDocumentToExternalAlert } from '@/utils/externalApi';

import { withToolTracing } from '../../utils/tracing';
import type { McpContext } from '../types';
import {
  type McpSaveAlertInput,
  mcpSaveAlertSchema,
  validateSaveAlertInput,
} from './schemas';

/**
 * Convert the flat MCP channel object into the discriminated-union
 * `AlertChannel` that the controller layer expects.
 */
function toAlertChannel(ch: McpSaveAlertInput['channel']): AlertChannel {
  return {
    type: 'webhook',
    webhookId: ch.webhookId,
  };
}

export function registerSaveAlert(
  server: McpServer,
  context: McpContext,
): void {
  const { teamId, userId } = context;
  const frontendUrl = config.FRONTEND_URL;

  server.registerTool(
    'hyperdx_save_alert',
    {
      title: 'Create or Update Alert',
      description:
        'Create a new alert (omit id) or update an existing one (provide id). ' +
        'Alerts monitor a saved search or dashboard tile and fire when the ' +
        'metric crosses a threshold. A webhook notification channel is required.',
      inputSchema: mcpSaveAlertSchema,
    },
    withToolTracing('hyperdx_save_alert', context, async input => {
      // ── Runtime cross-field validation ──
      const validationError = validateSaveAlertInput(input);
      if (validationError) {
        return {
          isError: true,
          content: [{ type: 'text' as const, text: validationError }],
        };
      }

      // ── Validate ID for updates (early return narrows input.id to string) ──
      const alertId = input.id;
      if (alertId != null && !mongoose.Types.ObjectId.isValid(alertId)) {
        return {
          isError: true,
          content: [{ type: 'text' as const, text: 'Invalid alert ID' }],
        };
      }

      // Build the alert input matching the shape expected by controllers.
      const channel = toAlertChannel(input.channel);
      const source =
        input.source === 'tile' ? AlertSource.TILE : AlertSource.SAVED_SEARCH;
      const alertInput: AlertInput = {
        source,
        channel,
        interval: input.interval,
        threshold: input.threshold,
        thresholdType: input.thresholdType as AlertThresholdType,
        thresholdMax: input.thresholdMax,
        scheduleOffsetMinutes: input.scheduleOffsetMinutes,
        scheduleStartAt: input.scheduleStartAt,
        name: input.name,
        message: input.message,
        groupBy: input.groupBy,
        savedSearchId: input.savedSearchId,
        dashboardId: input.dashboardId,
        tileId: input.tileId,
      };

      // ── Validate referenced entities exist ──
      const mongoTeamId = new mongoose.Types.ObjectId(teamId);
      try {
        await validateAlertInput(mongoTeamId, alertInput);
      } catch (e) {
        // BaseError subclasses (Api400Error, Api404Error, etc.) store the
        // descriptive message in `name` and a generic string in `message`.
        const msg =
          e instanceof BaseError
            ? e.name
            : e instanceof Error
              ? e.message
              : String(e);
        return {
          isError: true,
          content: [{ type: 'text' as const, text: msg }],
        };
      }

      const mongoUserId = new mongoose.Types.ObjectId(userId);

      // ── Update existing alert ──
      if (alertId) {
        const updated = await updateAlert(alertId, mongoTeamId, alertInput);
        if (!updated) {
          return {
            isError: true,
            content: [{ type: 'text' as const, text: 'Alert not found' }],
          };
        }
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                {
                  ...translateAlertDocumentToExternalAlert(updated),
                  ...(frontendUrl ? { url: `${frontendUrl}/alerts` } : {}),
                },
                null,
                2,
              ),
            },
          ],
        };
      }

      // ── Create new alert ──
      const created = await createAlert(
        mongoTeamId,
        alertInput as Parameters<typeof createAlert>[1],
        mongoUserId,
      );
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(
              {
                ...translateAlertDocumentToExternalAlert(created),
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
