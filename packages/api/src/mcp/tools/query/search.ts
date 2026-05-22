import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { withToolTracing } from '../../utils/tracing';
import type { McpContext } from '../types';
import { buildTile, parseTimeRange, runConfigTile } from './helpers';
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
        'Leave empty for defaults. Example: "Body,ServiceName,Duration"',
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
        'Requires sourceId — call hyperdx_list_sources then hyperdx_describe_source first.\n\n' +
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

      const tile = buildTile('MCP Search', 24, 6, {
        displayType: 'search' as const,
        sourceId: input.sourceId,
        select: input.columns,
        where: input.where,
        whereLanguage: input.whereLanguage,
      });

      return runConfigTile(teamId.toString(), tile, startDate, endDate, {
        maxResults: input.maxResults,
      });
    }),
  );
}
