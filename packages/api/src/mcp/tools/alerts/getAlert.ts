import { type AlertInterval } from '@hyperdx/common-utils/dist/types';
import { ObjectId } from 'mongodb';
import mongoose from 'mongoose';
import { z } from 'zod';

import * as config from '@/config';
import { getRecentAlertHistories } from '@/controllers/alertHistory';
import { getAlertById } from '@/controllers/alerts';
import type { ToolRegistrar } from '@/mcp/tools/types';
import { mcpUserError, validateObjectId } from '@/mcp/utils/errors';
import Alert from '@/models/alert';
import type { IDashboard } from '@/models/dashboard';
import type { ISavedSearch } from '@/models/savedSearch';
import { translateAlertDocumentToExternalAlertWithChartConfig } from '@/routers/external-api/v2/utils/alertChartConfig';
import { resolveAlertDisplayFields } from '@/utils/alerts';

export function registerGetAlert({
  context,
  registerTool,
}: ToolRegistrar): void {
  const { teamId } = context;
  const frontendUrl = config.FRONTEND_URL;

  registerTool(
    'clickstack_get_alert',
    {
      title: 'Get Alert(s)',
      annotations: { readOnlyHint: true },
      description:
        'Without an ID: list all alerts as a high-level summary ' +
        '(id, name, displayName, tags, state, source, interval). Optionally ' +
        'filter by state ' +
        '(e.g. state="ALERT" for firing alerts). ' +
        'With an ID: get full alert detail including configuration, ' +
        'displayName, tags, and recent evaluation history.',
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
    async ({ id, state }) => {
      // ── List all alerts (slim summary) ──
      if (!id) {
        const query: Record<string, unknown> = {
          team: new mongoose.Types.ObjectId(teamId),
        };
        if (state) {
          query.state = state;
        }
        const alerts = await Alert.find(query).populate<{
          savedSearch: ISavedSearch | null;
          dashboard: IDashboard | null;
        }>(['savedSearch', 'dashboard']);

        const output = alerts.map(alert => {
          const { displayName, tags } = resolveAlertDisplayFields(alert, {
            savedSearch: alert.savedSearch,
            dashboard: alert.dashboard,
          });
          return {
            id: alert._id.toString(),
            name: alert.name,
            displayName,
            tags,
            state: alert.state,
            source: alert.source,
            interval: alert.interval,
            ...(frontendUrl ? { url: `${frontendUrl}/alerts` } : {}),
          };
        });
        return {
          content: [
            { type: 'text' as const, text: JSON.stringify(output, null, 2) },
          ],
        };
      }

      // ── Get single alert (full detail) ──
      const idError = validateObjectId(id, 'alert ID');
      if (idError) return idError;

      const alert = await getAlertById(id, teamId);
      if (!alert) {
        return mcpUserError('Alert not found');
      }

      // Populate the refs the display name/tags derive from, so alerts written
      // before those fields existed still resolve to something meaningful.
      const populated = await alert.populate<{
        savedSearch: ISavedSearch | null;
        dashboard: IDashboard | null;
      }>(['savedSearch', 'dashboard']);

      const external =
        translateAlertDocumentToExternalAlertWithChartConfig(populated);

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
                ...external,
                history,
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
