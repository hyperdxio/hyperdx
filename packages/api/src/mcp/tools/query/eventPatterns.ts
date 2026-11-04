import { z } from 'zod';

import { READ_ONLY_TOOL } from '@/mcp/tools/annotations';
import type { ToolRegistrar } from '@/mcp/tools/types';
import { mcpUserError } from '@/mcp/utils/errors';

import { PREFER_BUILDER_OVER_SQL_NUDGE } from './builderCatalog';
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
      'Random rows to sample for pattern mining. ' +
        'Higher values produce more accurate patterns but take longer. ' +
        'Patterns rarer than about 1/sampleSize of matching rows may not appear at all.',
    ),
  bodyExpression: z
    .string()
    .optional()
    .describe(
      'Expression to mine patterns from: a column or map reference, or JSONExtractString ' +
        'over one with string-literal keys to mine a field inside a JSON body. ' +
        'Auto-detected from the source if omitted (Body for logs, SpanName for traces). ' +
        'Examples: "Body", "SpanName", "LogAttributes[\'exception.type\']", ' +
        "\"JSONExtractString(Body, 'error', 'message')\". Other function calls are rejected. " +
        "Rows where the value is '' (missing key, invalid JSON) are mined as an empty " +
        'pattern; add where "<expression> != \'\'" (whereLanguage:"sql") to exclude them.',
    ),
  topN: z
    .number()
    .min(1)
    .max(100)
    .optional()
    .default(20)
    .describe('Number of most frequent patterns to return.'),
  trendBuckets: z
    .number()
    .min(0)
    .max(60)
    .optional()
    .default(24)
    .describe(
      'Maximum number of time buckets for per-pattern trends. The bucket width is rounded ' +
        'up to a standard interval (15s, 1m, 5m, 15m, 30m, 1h, ...) and aligned to it, so ' +
        'fewer buckets can come back and the first can start before startTime; ' +
        'summary.trend reports the actual interval and boundaries. ' +
        'Trend counts are extrapolated from the sample, so sparse buckets read 0 even when ' +
        'events occurred. Set to 0 to disable trends (smaller response).',
    ),
  startTime: startTimeSchema,
  endTime: endTimeSchema,
});

// ─── Tool registration ───────────────────────────────────────────────────────

export function registerEventPatterns({
  context,
  registerTool,
}: ToolRegistrar) {
  const { teamId } = context;

  registerTool(
    'clickstack_event_patterns',
    {
      title: 'Event Pattern Mining',
      annotations: READ_ONLY_TOOL,
      description:
        'Discover what kinds of messages, errors, or events exist. Samples random events, ' +
        'clusters them into templates (Drain), and returns patterns ranked by frequency with ' +
        'sampled and estimated counts, optional trends, and raw samples. Use for "what errors ' +
        'are happening", common or noisy logs, recurring messages.\n\n' +
        'Examples:\n' +
        '  - "What kinds of errors is checkout producing?" → where:"ServiceName:checkout AND ' +
        'SeverityText:error", topN:5, sampleSize:1000 (trends on by default)\n' +
        '  - "What messages dominate this service?" → where:"ServiceName:api", trendBuckets:0\n' +
        '  - Patterns in a map attribute → bodyExpression:"LogAttributes[\'exception.type\']", ' +
        'where:"LogAttributes[\'exception.type\'] != \'\'", whereLanguage:"sql"\n' +
        '  - A field inside JSON bodies → bodyExpression:"JSONExtractString(Body, \'message\')", ' +
        'where:"JSONExtractString(Body, \'message\') != \'\'", whereLanguage:"sql"\n\n' +
        'Use instead: exact counts or breakdowns by a known field → clickstack_table / ' +
        'clickstack_timeseries; raw rows → clickstack_search; patterns new or gone vs an ' +
        'earlier window → clickstack_emerging_signals.\n\n' +
        'Counts come from a sample: estimatedCount is an extrapolation, and a pattern with ' +
        '0 sampled events may still exist.\n\n' +
        'Drill down: call clickstack_search with the same sourceId and time range, ' +
        'where = a pattern\'s whereSnippet, whereLanguage = "sql". whereSnippet already ' +
        'includes your where filter unless summary.drilldown.includesFilters is false.\n\n' +
        'Requires sourceId — call clickstack_list_sources then clickstack_describe_source first.\n\n' +
        PREFER_BUILDER_OVER_SQL_NUDGE,
      inputSchema: eventPatternsSchema,
    },
    async input => {
      const timeRange = parseTimeRange(input.startTime, input.endTime);
      if ('error' in timeRange) {
        return mcpUserError(timeRange.error);
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
    },
  );
}
