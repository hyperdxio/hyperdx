import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { withToolTracing } from '../../utils/tracing';
import type { McpContext } from '../types';
import { parseTimeRange } from './helpers';
import { runEventPatterns } from './runEventPatterns';
import {
  endTimeSchema,
  sourceIdSchema,
  startTimeSchema,
  whereLanguageSchema,
  whereSchema,
} from './schemas';

// ─── Schema ──────────────────────────────────────────────────────────────────

const eventPatternsSchema = z.object({
  sourceId: sourceIdSchema,
  where: whereSchema,
  whereLanguage: whereLanguageSchema,
  // TODO: explore whether we can safely increase the max beyond 25_000
  sampleSize: z
    .number()
    .min(1)
    .max(25_000)
    .optional()
    .default(10_000)
    .describe(
      'Number of random rows to sample for pattern mining. ' +
        'Default: 10000. Higher values produce more accurate patterns but take longer.',
    ),
  bodyExpression: z
    .string()
    .optional()
    .describe(
      'Column expression to mine patterns from. ' +
        'Auto-detected from the source if omitted (Body for logs, SpanName for traces). ' +
        'Example: "Body", "SpanName", "SpanAttributes[\'http.url\']"',
    ),
  topN: z
    .number()
    .min(1)
    .max(100)
    .optional()
    .default(20)
    .describe('Number of top patterns to return (1-100). Default: 20.'),
  trendBuckets: z
    .number()
    .min(0)
    .max(60)
    .optional()
    .default(24)
    .describe(
      'Number of time buckets for per-pattern trend sparklines (0-60). Default: 24. ' +
        'Compare bucket counts at start vs end to spot patterns that started or stopped mid-window. ' +
        'Set to 0 to disable trend computation (smaller response).',
    ),
  startTime: startTimeSchema,
  endTime: endTimeSchema,
});

// ─── Tool registration ───────────────────────────────────────────────────────

export function registerEventPatterns(server: McpServer, context: McpContext) {
  const { teamId } = context;

  server.registerTool(
    'hyperdx_event_patterns',
    {
      title: 'Event Pattern Mining',
      description:
        'Discover the most common log messages and event patterns. ' +
        'Samples random events, clusters them using the Drain algorithm, and returns ' +
        'patterns sorted by frequency with estimated counts and time trends.\n\n' +
        'Use this when asked about "top patterns", "common logs", "noisy services", ' +
        '"recurring messages", or log noise analysis.\n\n' +
        'Each pattern includes a "whereSnippet" — use it as the "where" parameter in ' +
        'a follow-up hyperdx_search call to browse matching raw events.\n\n' +
        'Requires sourceId — call hyperdx_list_sources then hyperdx_describe_source first.\n\n' +
        'When to use which tool:\n' +
        '  - hyperdx_event_patterns: clustering / recurring shapes / noise analysis\n' +
        '  - hyperdx_search: raw individual rows\n' +
        '  - hyperdx_table: aggregated metrics / counts / top-N',
      inputSchema: eventPatternsSchema,
    },
    withToolTracing('hyperdx_event_patterns', context, async input => {
      const timeRange = parseTimeRange(input.startTime, input.endTime);
      if ('error' in timeRange) {
        return {
          isError: true,
          content: [{ type: 'text' as const, text: timeRange.error }],
        };
      }
      const { startDate, endDate } = timeRange;

      return runEventPatterns(
        teamId.toString(),
        input.sourceId,
        startDate,
        endDate,
        {
          where: input.where,
          whereLanguage: input.whereLanguage,
          bodyExpression: input.bodyExpression,
          sampleSize: input.sampleSize,
          topN: input.topN,
          trendBuckets: input.trendBuckets,
        },
      );
    }),
  );
}
