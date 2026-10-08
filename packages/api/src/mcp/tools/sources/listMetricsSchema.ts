import { z } from 'zod';

import {
  decodeCursor as decodeCursorPayload,
  encodeCursor as encodeCursorPayload,
} from '@/utils/pagination';

import { DISCOVERABLE_METRIC_KINDS } from './metricKinds';

export const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 500;

const cursorPayloadSchema = z.object({
  kind: z.enum(DISCOVERABLE_METRIC_KINDS),
  // Absent when the next page starts at the beginning of `kind`.
  lastName: z.string().optional(),
});

export type ListMetricsCursorPayload = z.infer<typeof cursorPayloadSchema>;

/** @internal Exported for testing. */
export function encodeCursor(payload: ListMetricsCursorPayload): string {
  return encodeCursorPayload(payload);
}

/** @internal Exported for testing. */
export function decodeCursor(raw: string): ListMetricsCursorPayload | null {
  return decodeCursorPayload(raw, cursorPayloadSchema);
}

export const listMetricsSchema = z.object({
  sourceId: z
    .string()
    .describe(
      'Source ID. Must reference a metric source — get IDs from clickstack_list_sources.',
    ),
  kind: z
    .enum(DISCOVERABLE_METRIC_KINDS)
    .optional()
    .describe(
      'Optional metric kind filter. Omit to scan every populated kind on the source ' +
        '(gauge, sum, histogram, exponential histogram, summary). Set to narrow results to one kind. ' +
        'NOTE: summary metrics are discovery-only — they cannot be passed to ' +
        'clickstack_timeseries / clickstack_table; query them with clickstack_sql.',
    ),
  namePattern: z
    .string()
    .optional()
    .describe(
      'Optional ClickHouse ILIKE pattern applied to MetricName server-side. ' +
        'Use % as the wildcard. Examples: "system.cpu.%", "%duration%", "http.server.%".',
    ),
  startTime: z
    .string()
    .optional()
    .describe(
      'Restrict to metrics with data points after this ISO 8601 timestamp. ' +
        'Default: 24 hours before endTime (or now).',
    ),
  endTime: z
    .string()
    .optional()
    .describe('End of the time window as ISO 8601. Default: now.'),
  limit: z
    .number()
    .int()
    .min(1)
    .max(MAX_LIMIT)
    .optional()
    .default(DEFAULT_LIMIT)
    .describe(
      `Max metrics returned per page. Default ${DEFAULT_LIMIT}, max ${MAX_LIMIT}.`,
    ),
  cursor: z
    .string()
    .optional()
    .describe(
      'Opaque pagination cursor returned by a previous call as `nextCursor`. ' +
        'Pass it back unchanged to get the next page.',
    ),
});
