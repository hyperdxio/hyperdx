import { z } from 'zod';

import { parseTimeRange, runConfigTile } from '@/mcp/tools/query/helpers';
import type { ToolRegistrar } from '@/mcp/tools/types';
import { mcpUserError } from '@/mcp/utils/errors';
import Dashboard from '@/models/dashboard';
import { convertToExternalDashboard } from '@/routers/external-api/v2/utils/dashboards';
import { objectIdSchema } from '@/utils/zod';

import {
  getMetricTileAggFnErrors,
  getRawSqlTileMacroWarnings,
} from './validation';

export function registerQueryTile({
  context,
  registerTool,
}: ToolRegistrar): void {
  const { teamId } = context;

  registerTool(
    'clickstack_query_tile',
    {
      title: 'Query a Dashboard Tile',
      description:
        'Execute the query for a specific tile on an existing dashboard. ' +
        'Useful for validating that a tile returns data or for spot-checking results ' +
        'without rebuilding the query from scratch. ' +
        'Use clickstack_get_dashboard with an ID to find tile IDs.',
      inputSchema: z.object({
        dashboardId: objectIdSchema.describe('Dashboard ID.'),
        tileId: z
          .string()
          .describe(
            'Tile ID within the dashboard. ' +
              'Obtain from clickstack_get_dashboard.',
          ),
        startTime: z
          .string()
          .optional()
          .describe(
            'Start of the query window as ISO 8601. Default: 15 minutes ago. ' +
              'If results are empty, try a wider range (e.g. 24 hours).',
          ),
        endTime: z
          .string()
          .optional()
          .describe('End of the query window as ISO 8601. Default: now.'),
      }),
    },
    async ({ dashboardId, tileId, startTime, endTime }) => {
      const timeRange = parseTimeRange(startTime, endTime);
      if ('error' in timeRange) {
        return mcpUserError(timeRange.error);
      }
      const { startDate, endDate } = timeRange;

      const dashboard = await Dashboard.findOne({
        _id: dashboardId,
        team: teamId,
      });
      if (!dashboard) {
        return mcpUserError('Dashboard not found');
      }

      const externalDashboard = convertToExternalDashboard(dashboard);
      const tile = externalDashboard.tiles.find(t => t.id === tileId);
      if (!tile) {
        return mcpUserError(
          `Tile not found: ${tileId}. Available tile IDs: ${externalDashboard.tiles.map(t => t.id).join(', ')}`,
        );
      }

      // Guard against executing a tile whose persisted metric config uses an
      // aggFn its metric kind does not support (e.g. avg/sum/min/max on a
      // histogram). Such tiles can exist when created outside MCP validation
      // (REST/UI/legacy); running them would surface an opaque ClickHouse
      // render error instead of an actionable message.
      const metricAggFnErrors = getMetricTileAggFnErrors([tile]);
      if (metricAggFnErrors.length > 0) {
        return mcpUserError(metricAggFnErrors.join('\n'));
      }

      const result = await runConfigTile(
        teamId.toString(),
        tile,
        startDate,
        endDate,
      );

      // Surface non-blocking missing macro warnings alongside
      // the successful result so the agent can spot a tile that runs but
      // ignores dashboard controls.
      const macroWarnings = getRawSqlTileMacroWarnings([tile]);
      if (
        macroWarnings.length > 0 &&
        !('isError' in result && result.isError) &&
        result.content?.[0]?.type === 'text'
      ) {
        try {
          const parsed = JSON.parse(result.content[0].text);
          parsed.warnings = macroWarnings;
          result.content[0].text = JSON.stringify(parsed, null, 2);
        } catch {
          // leave result unmodified
        }
      }

      return result;
    },
  );
}
