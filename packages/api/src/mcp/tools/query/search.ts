import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ObjectId } from 'mongodb';
import { z } from 'zod';

import type { ExternalDashboardTileWithId } from '@/utils/zod';
import { externalDashboardTileSchemaWithId } from '@/utils/zod';

import { withToolTracing } from '../../utils/tracing';
import type { McpContext } from '../types';
import { parseTimeRange, runConfigTile } from './helpers';
import {
  endTimeSchema,
  sourceIdSchema,
  startTimeSchema,
  whereLanguageSchema,
  whereSchema,
} from './schemas';

// ─── Schema ──────────────────────────────────────────────────────────────────

const searchSchema = z.object({
  sourceId: sourceIdSchema,
  where: whereSchema,
  whereLanguage: whereLanguageSchema,
  columns: z
    .string()
    .optional()
    .default('')
    .describe(
      'Comma-separated columns to include in search results. ' +
        'Leave empty for defaults. Example: "body,service.name,duration"',
    ),
  maxResults: z
    .number()
    .min(1)
    .max(200)
    .optional()
    .default(50)
    .describe(
      'Maximum number of rows to return (1-200). Default: 50. ' +
        'Use smaller values to reduce response size.',
    ),
  startTime: startTimeSchema,
  endTime: endTimeSchema,
});

// ─── Tool registration ───────────────────────────────────────────────────────

export function registerSearch(server: McpServer, context: McpContext) {
  const { teamId } = context;

  server.registerTool(
    'hyperdx_search',
    {
      title: 'Search Events',
      description:
        'Browse individual log/event/trace rows. ' +
        'Use this when you need to see raw events, investigate specific log lines, ' +
        'or drill into individual records matching a filter.\n\n' +
        'Requires sourceId — call hyperdx_list_sources first.\n\n' +
        'For aggregated metrics, use hyperdx_table instead. ' +
        'For pattern discovery, use hyperdx_event_patterns instead.\n\n' +
        'Column naming: top-level columns are PascalCase (Duration, StatusCode). ' +
        "Map attributes use bracket syntax: SpanAttributes['http.method'].",
      inputSchema: searchSchema,
    },
    withToolTracing('hyperdx_search', context, async input => {
      const timeRange = parseTimeRange(input.startTime, input.endTime);
      if ('error' in timeRange) {
        return {
          isError: true,
          content: [{ type: 'text' as const, text: timeRange.error }],
        };
      }
      const { startDate, endDate } = timeRange;

      const tile: ExternalDashboardTileWithId =
        externalDashboardTileSchemaWithId.parse({
          id: new ObjectId().toString(),
          name: 'MCP Search',
          x: 0,
          y: 0,
          w: 24,
          h: 6,
          config: {
            displayType: 'search' as const,
            sourceId: input.sourceId,
            select: input.columns,
            where: input.where ?? '',
            whereLanguage: input.whereLanguage ?? 'lucene',
          },
        });

      return runConfigTile(teamId.toString(), tile, startDate, endDate, {
        maxResults: input.maxResults,
      });
    }),
  );
}
