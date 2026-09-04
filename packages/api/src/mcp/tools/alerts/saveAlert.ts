import { AlertThresholdType } from '@hyperdx/common-utils/dist/types';
import mongoose from 'mongoose';

import * as config from '@/config';
import {
  type AlertInput,
  createAlert,
  updateAlert,
  validateAlertInput,
} from '@/controllers/alerts';
import type { ToolRegistrar } from '@/mcp/tools/types';
import {
  formatZodIssues,
  mcpServerError,
  mcpUserError,
  validateObjectId,
} from '@/mcp/utils/errors';
import { AlertSource } from '@/models/alert';
import {
  convertExternalAlertChartConfigToInternal,
  translateAlertDocumentToExternalAlertWithChartConfig,
} from '@/routers/external-api/v2/utils/alertChartConfig';
import { BaseError } from '@/utils/errors';
import { externalAlertChartConfigSchema } from '@/utils/zod';

import { mcpSaveAlertSchema, validateSaveAlertInput } from './schemas';

const MCP_SOURCE_TO_ALERT_SOURCE = {
  saved_search: AlertSource.SAVED_SEARCH,
  tile: AlertSource.TILE,
  inline: AlertSource.INLINE,
} as const;

export function registerSaveAlert({
  context,
  registerTool,
}: ToolRegistrar): void {
  const { teamId, userId } = context;
  const frontendUrl = config.FRONTEND_URL;

  registerTool(
    'clickstack_save_alert',
    {
      title: 'Create or Update Alert',
      annotations: { destructiveHint: true },
      description:
        'Create a new alert (omit id) or update an existing one (provide id). ' +
        'Alerts monitor a saved search, a dashboard tile, or an inline chart ' +
        'config (source "inline" + chartConfig — no saved search or dashboard ' +
        'needed) and fire when the metric crosses a threshold. At least one ' +
        'webhook notification channel ' +
        'is required: pass "channels" for 1-10 targets, or the legacy singular ' +
        '"channel" for one. Updates replace the alert configuration rather than ' +
        'merging it, so read the alert first and resend its full "channels" ' +
        'array to avoid dropping channels you did not mean to remove.',
      inputSchema: mcpSaveAlertSchema,
    },
    async input => {
      // ── Runtime cross-field validation ──
      const validationError = validateSaveAlertInput(input);
      if (validationError) {
        return mcpUserError(validationError);
      }

      // ── Validate ID for updates (early return narrows input.id to string) ──
      const alertId = input.id;
      if (alertId != null) {
        const idError = validateObjectId(alertId, 'alert ID');
        if (idError) return idError;
      }

      // Inline alerts: run the chart config through the shared external
      // schema (same one the v2 REST API parses) so formula validation and
      // the number single-select rule cannot drift between the surfaces,
      // then convert to the internal shape the controllers persist.
      let internalChartConfig: AlertInput['chartConfig'];
      if (input.source === 'inline') {
        // The MCP tile dialect spells the gauge delta flag `isDelta`; the
        // shared external schema spells it `periodAggFn: 'delta'` and strips
        // unknown keys. The MCP select-item schema already emits both
        // spellings in agreement (see mcpTileSelectItemSchema), so the flag
        // survives this parse.
        const parsed = externalAlertChartConfigSchema.safeParse(
          input.chartConfig,
        );
        if (!parsed.success) {
          return mcpUserError(
            `Invalid chartConfig:\n${formatZodIssues(parsed.error)}`,
          );
        }
        internalChartConfig = convertExternalAlertChartConfigToInternal(
          parsed.data,
        );
      }

      // Build the alert input matching the shape expected by controllers.
      const source = MCP_SOURCE_TO_ALERT_SOURCE[input.source];
      const alertInput: AlertInput = {
        source,
        // `channel` is omitted; makeAlert mirrors it from channels[0].
        channels: input.channels ?? (input.channel ? [input.channel] : []),
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
        chartConfig: internalChartConfig,
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
        return e instanceof BaseError ? mcpUserError(msg) : mcpServerError(msg);
      }

      const mongoUserId = new mongoose.Types.ObjectId(userId);

      // ── Update existing alert ──
      if (alertId) {
        const updated = await updateAlert(alertId, mongoTeamId, alertInput);
        if (!updated) {
          return mcpUserError('Alert not found');
        }
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                {
                  ...translateAlertDocumentToExternalAlertWithChartConfig(
                    updated,
                  ),
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
                ...translateAlertDocumentToExternalAlertWithChartConfig(
                  created,
                ),
                ...(frontendUrl ? { url: `${frontendUrl}/alerts` } : {}),
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
