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
      'Restrict results to one metric kind. Omit to scan every kind that has ' +
        'a table on the source. ' +
        'NOTE: summary metrics are discovery-only — they cannot be passed to ' +
        'clickstack_timeseries / clickstack_table; query them with clickstack_sql.',
    ),
  namePattern: z
    .string()
    .optional()
    .describe(
      'ClickHouse ILIKE pattern (case-insensitive) matched against MetricName. ' +
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
      'Maximum metrics returned per page. Use cursor to fetch further pages.',
    ),
  cursor: z
    .string()
    .optional()
    .describe(
      'Opaque pagination cursor returned by a previous call as `nextCursor`. ' +
        'Pass it back unchanged to get the next page.',
    ),
});
