import ms from 'ms';
import { z } from 'zod';

import {
  sourceIdSchema,
  whereLanguageSchema,
  whereSchema,
} from '@/mcp/tools/query/schemas';

const COMPARISON_MODES = [
  'yesterday',
  'previous_period',
  'last_week',
  'none',
] as const;
export type ComparisonMode = (typeof COMPARISON_MODES)[number];

export const DEFAULT_WINDOW_MS = ms('1h');

export const serviceHealthSchema = z.object({
  sourceId: sourceIdSchema.describe(
    'The "id" of a kind="trace" source from clickstack_list_sources (24-char ' +
      'hex, e.g. "6a4c18f1d64c5f47bb275fbe"). Not the source name or table.',
  ),
  startTime: z
    .string()
    .optional()
    .describe(
      'Start of the window to assess (ISO 8601). Default: 1 hour before endTime.',
    ),
  endTime: z
    .string()
    .optional()
    .describe('End of the window to assess (ISO 8601). Defaults to now.'),
  comparison: z
    .enum(COMPARISON_MODES)
    .optional()
    .default('yesterday')
    .describe(
      'Window to compare against, always the same length as the assessed window:\n' +
        '  yesterday (default): shifted back 24h, so daily traffic cycles line up\n' +
        '  previous_period: the window immediately before startTime\n' +
        '  last_week: shifted back 7 days\n' +
        '  none: no comparison; only absolute thresholds apply\n' +
        'If the chosen window has no data, the previous period is used instead.',
    ),
  where: whereSchema,
  whereLanguage: whereLanguageSchema,
  spanKind: z
    .enum(['server', 'all'])
    .optional()
    .default('server')
    .describe(
      'Which spans count as requests. server (default): entry-point spans only, ' +
        'matching the Services dashboard. all: every span, including internal ' +
        'and client calls, which inflates throughput and dilutes error rate and latency changes.',
    ),
  services: z
    .array(z.string().min(1))
    .max(100)
    .optional()
    .describe('Only assess these service names. Omit to assess every service.'),
  topN: z
    .number()
    .int()
    .min(1)
    .max(100)
    .optional()
    .default(20)
    .describe('Max services returned, worst first.'),
  topErrorsPerService: z
    .number()
    .int()
    .min(0)
    .max(10)
    .optional()
    .default(3)
    .describe(
      'Error groups returned per service. 0 skips the error breakdown, which is faster.',
    ),
  errorGroupBy: z
    .string()
    .optional()
    .describe(
      'Comma-separated SQL expressions that define an error group. Defaults to the ' +
        "source's span name and status message. Example: " +
        '"SpanName, SpanAttributes[\'exception.type\']".',
    ),
  minRequests: z
    .number()
    .int()
    .min(1)
    .optional()
    .default(50)
    .describe(
      'Services with fewer requests than this in both windows are never flagged; ' +
        'their ratios are too noisy.',
    ),
});

export type ServiceHealthInput = z.infer<typeof serviceHealthSchema>;

export type Window = { start: Date; end: Date };

/** The comparison window for a mode, or null for `none`. */
export function comparisonWindow(
  current: Window,
  mode: ComparisonMode,
): Window | null {
  const lengthMs = current.end.getTime() - current.start.getTime();
  const shiftMs =
    mode === 'yesterday'
      ? ms('1d')
      : mode === 'last_week'
        ? ms('7d')
        : mode === 'previous_period'
          ? lengthMs
          : null;
  if (shiftMs == null) return null;
  return {
    start: new Date(current.start.getTime() - shiftMs),
    end: new Date(current.end.getTime() - shiftMs),
  };
}
