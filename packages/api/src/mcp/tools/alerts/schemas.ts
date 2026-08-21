import {
  ALERT_INTERVAL_TO_MINUTES,
  type AlertInterval,
  checkAlertChannelSelection,
  isRangeThresholdType,
  MAX_ALERT_CHANNELS,
} from '@hyperdx/common-utils/dist/types';
import { z } from 'zod';

// ---------------------------------------------------------------------------
// MCP-compatible flat Zod schema for clickstack_save_alert.
//
// The MCP SDK's normalizeObjectSchema() cannot serialize ZodEffects
// (superRefine) or discriminatedUnion.  We keep the inputSchema as a plain
// z.object() and perform cross-field validation at runtime via
// validateSaveAlertInput().
// ---------------------------------------------------------------------------

const mcpAlertChannelSchema = z
  .object({
    type: z
      .literal('webhook')
      .describe('Channel type for alert notifications.'),
    webhookId: z
      .string()
      .describe('Webhook destination ID (required for webhook channel).'),
  })
  .describe('Alert notification channel configuration.');

export const mcpSaveAlertSchema = z.object({
  id: z
    .string()
    .optional()
    .describe(
      'Alert ID. Omit to create a new alert, provide to update an existing one.',
    ),

  // Source
  source: z
    .enum(['saved_search', 'tile'])
    .describe('Alert source type: saved_search or tile.'),
  savedSearchId: z
    .string()
    .optional()
    .describe('Saved search ID (required when source is saved_search).'),
  dashboardId: z
    .string()
    .optional()
    .describe('Dashboard ID (required when source is tile).'),
  tileId: z
    .string()
    .optional()
    .describe(
      'Tile ID within the dashboard (required when source is tile). Must be a line, stacked bar, or number tile.',
    ),
  groupBy: z
    .string()
    .optional()
    .describe('Group-by key for saved search alerts.'),

  // Threshold
  threshold: z.number().describe('Threshold value for triggering the alert.'),
  thresholdType: z
    .enum([
      'above',
      'below',
      'above_exclusive',
      'below_or_equal',
      'equal',
      'not_equal',
      'between',
      'not_between',
    ])
    .describe('How the metric value is compared against the threshold.'),
  thresholdMax: z
    .number()
    .optional()
    .describe(
      'Upper bound (required when thresholdType is between or not_between, must be >= threshold).',
    ),

  // Schedule
  interval: z
    .enum(['1m', '5m', '15m', '30m', '1h', '6h', '12h', '1d'])
    .describe('Evaluation interval.'),
  scheduleOffsetMinutes: z
    .number()
    .int()
    .min(0)
    .max(1439)
    .optional()
    .describe(
      'Offset from the interval boundary in minutes (must be < interval).',
    ),
  scheduleStartAt: z
    .string()
    .datetime()
    .nullable()
    .optional()
    .describe('Absolute UTC anchor for window alignment (ISO 8601).'),

  // Channel
  channel: mcpAlertChannelSchema.optional(),
  channels: z
    .array(mcpAlertChannelSchema)
    .min(1)
    .max(MAX_ALERT_CHANNELS)
    .optional()
    .describe(
      `Notification channels (1-${MAX_ALERT_CHANNELS}). Provide this or "channel"; if both, "channel" must match the first entry.`,
    ),

  // Metadata
  name: z
    .string()
    .min(1)
    .max(512)
    .optional()
    .describe('Human-friendly alert name.'),
  message: z
    .string()
    .min(1)
    .max(4096)
    .optional()
    .describe('Alert message template (supports Handlebars syntax).'),
});

export type McpSaveAlertInput = z.infer<typeof mcpSaveAlertSchema>;

// ---------------------------------------------------------------------------
// Runtime cross-field validation (not in Zod to avoid ZodEffects).
// Returns a human-readable error string, or null when valid.
// ---------------------------------------------------------------------------
export function validateSaveAlertInput(data: McpSaveAlertInput): string | null {
  // Channel selection rule shared with every other alert input schema in this
  // repo (see checkAlertChannelSelection in common-utils); reported here as a
  // plain string since this validator has no ZodIssueCode to add to.
  const channelSelection = checkAlertChannelSelection(data);
  if (!channelSelection.ok) {
    switch (channelSelection.code) {
      case 'missing':
        return 'Provide either "channel" or "channels"';
      case 'mismatch':
        return 'When both "channel" and "channels" are provided, "channel" must match the first entry of "channels"';
      case 'duplicate':
        return 'Duplicate notification channels are not allowed';
    }
  }

  // Source-specific required fields
  if (data.source === 'tile') {
    if (!data.dashboardId) {
      return 'dashboardId is required when source is "tile"';
    }
    if (!data.tileId) {
      return 'tileId is required when source is "tile"';
    }
  }
  if (data.source === 'saved_search') {
    if (!data.savedSearchId) {
      return 'savedSearchId is required when source is "saved_search"';
    }
  }

  // Threshold range checks
  if (isRangeThresholdType(data.thresholdType)) {
    if (data.thresholdMax == null) {
      return `thresholdMax is required when thresholdType is "${data.thresholdType}"`;
    }
    if (data.thresholdMax < data.threshold) {
      return 'thresholdMax must be >= threshold';
    }
  }

  // Schedule offset must be less than the interval
  if (data.scheduleOffsetMinutes != null) {
    const intervalMinutes =
      ALERT_INTERVAL_TO_MINUTES[data.interval as AlertInterval];
    if (
      intervalMinutes != null &&
      data.scheduleOffsetMinutes >= intervalMinutes
    ) {
      return `scheduleOffsetMinutes (${data.scheduleOffsetMinutes}) must be less than the interval (${data.interval} = ${intervalMinutes} minutes)`;
    }
  }

  return null;
}
