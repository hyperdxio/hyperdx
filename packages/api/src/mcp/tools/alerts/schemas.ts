import {
  ALERT_INTERVAL_TO_MINUTES,
  type AlertInterval,
  checkAlertChannelSelection,
  isRangeThresholdType,
  MAX_ALERT_CHANNELS,
  SearchConditionTrimmedLanguageSchema,
} from '@hyperdx/common-utils/dist/types';
import { z } from 'zod';

import {
  mcpBarTileSchema,
  mcpLineTileSchema,
  mcpNumberTileSchema,
  mcpSqlTileSchema,
} from '@/mcp/tools/dashboards/schemas';

// ---------------------------------------------------------------------------
// MCP-compatible flat Zod schema for clickstack_save_alert.
//
// The MCP SDK's normalizeObjectSchema() cannot serialize ZodEffects
// (superRefine) or discriminatedUnion.  We keep the inputSchema as a plain
// z.object() and perform cross-field validation at runtime via
// validateSaveAlertInput().
// ---------------------------------------------------------------------------

// Inline alerts carry their chart config in the same dialect as dashboard
// tile configs, restricted to the display types the alert evaluator can run
// as a time series: line, stacked_bar, and number (builder or raw SQL).
// Reuses the dashboard tile config shapes so agents author both from one
// vocabulary; the raw SQL variant narrows displayType and drops the
// tile-only onClick affordance. Full validation (formulas, number
// single-select rule, source/connection ownership) runs at save time via the
// shared external alert schema and validateAlertInput.
//
// Unlike tiles, an alert's config carries its own `name` (used in
// notification titles) and — builder variants only — a chart-level
// `where`/`whereLanguage` filter ANDed into every series, so those override
// the tile schemas' rejected-never fields here.
const mcpAlertChartConfigNameSchema = z
  .string()
  .optional()
  .describe(
    'Display name for the alert query, used in notification titles when the ' +
      'alert has no explicit name.',
  );

const mcpAlertChartLevelWhereSchema = z
  .string()
  .max(10000)
  .optional()
  .describe(
    'Chart-level filter applied to every select item (combined with each ' +
      "item's own `where` via AND). Lucene syntax by default.",
  );

const rejectedRawSqlAlertWhereField = z
  .never({
    invalid_type_error:
      'Raw SQL alert configs have no chart-level where; filter inside the sqlTemplate instead',
  })
  .optional()
  .describe(
    'Not supported on Raw SQL alert configs. Filter inside the sqlTemplate.',
  );

const mcpAlertChartConfigSchema = z
  .union([
    mcpLineTileSchema.shape.config.extend({
      name: mcpAlertChartConfigNameSchema,
      where: mcpAlertChartLevelWhereSchema,
      whereLanguage: SearchConditionTrimmedLanguageSchema.optional(),
    }),
    mcpBarTileSchema.shape.config.extend({
      name: mcpAlertChartConfigNameSchema,
      where: mcpAlertChartLevelWhereSchema,
      whereLanguage: SearchConditionTrimmedLanguageSchema.optional(),
    }),
    mcpNumberTileSchema.shape.config.extend({
      name: mcpAlertChartConfigNameSchema,
      where: mcpAlertChartLevelWhereSchema,
      whereLanguage: SearchConditionTrimmedLanguageSchema.optional(),
    }),
    mcpSqlTileSchema.shape.config.omit({ onClick: true }).extend({
      name: mcpAlertChartConfigNameSchema,
      where: rejectedRawSqlAlertWhereField,
      whereLanguage: rejectedRawSqlAlertWhereField,
      displayType: z
        .enum(['line', 'stacked_bar', 'number'])
        .describe(
          'How to render the SQL results. Alerts evaluate line, stacked_bar, or number charts only.',
        ),
    }),
  ])
  .describe(
    'Chart configuration for inline alerts (required when source is "inline"). ' +
      'Same shape as a dashboard tile config, limited to displayType line, ' +
      'stacked_bar, or number. Omit configType for the builder variant ' +
      '(sourceId + select); set configType to "sql" for the Raw SQL variant ' +
      '(connectionId + sqlTemplate; the template must use the $__timeFilter ' +
      'and $__timeInterval macros so each evaluation window can be queried).',
  );

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
    .enum(['saved_search', 'tile', 'inline'])
    .describe(
      'Alert source type: "saved_search" monitors a saved search, "tile" ' +
        'monitors a dashboard tile, and "inline" carries its own chartConfig ' +
        'without requiring a saved search or dashboard.',
    ),
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
  chartConfig: mcpAlertChartConfigSchema.optional(),

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
  if (data.source === 'inline' && data.chartConfig == null) {
    return 'chartConfig is required when source is "inline"';
  }
  // Reject rather than silently drop a whole config: the caller clearly
  // intended an inline alert.
  if (data.source !== 'inline' && data.chartConfig != null) {
    return 'chartConfig is only supported when source is "inline"';
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
