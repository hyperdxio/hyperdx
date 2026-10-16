import {
  ALERT_INTERVAL_TO_MINUTES,
  alertDisplayNameSchema,
  type AlertInterval,
  checkAlertChannelSelection,
  isRangeThresholdType,
  MAX_ALERT_CHANNELS,
  SearchConditionTrimmedLanguageSchema,
  tagsSchema,
} from '@hyperdx/common-utils/dist/types';
import { z } from 'zod';

import {
  mcpBarTileSchema,
  mcpLineTileSchema,
  mcpNumberTileSchema,
  mcpSqlTileSchema,
  mcpStackedLineTileSchema,
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
// as a time series: line, stacked_bar, stacked_line, and number (builder or
// raw SQL).
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
      "item's own `where` via AND). Write it in the language set by whereLanguage.",
  );

const mcpAlertChartLevelWhereLanguageSchema =
  SearchConditionTrimmedLanguageSchema.optional().describe(
    'Query language the chart-level `where` is written in. Lucene when omitted.',
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
      whereLanguage: mcpAlertChartLevelWhereLanguageSchema,
    }),
    mcpBarTileSchema.shape.config.extend({
      name: mcpAlertChartConfigNameSchema,
      where: mcpAlertChartLevelWhereSchema,
      whereLanguage: mcpAlertChartLevelWhereLanguageSchema,
    }),
    mcpStackedLineTileSchema.shape.config.extend({
      name: mcpAlertChartConfigNameSchema,
      where: mcpAlertChartLevelWhereSchema,
      whereLanguage: mcpAlertChartLevelWhereLanguageSchema,
    }),
    mcpNumberTileSchema.shape.config.extend({
      name: mcpAlertChartConfigNameSchema,
      where: mcpAlertChartLevelWhereSchema,
      whereLanguage: mcpAlertChartLevelWhereLanguageSchema,
    }),
    mcpSqlTileSchema.shape.config.omit({ onClick: true }).extend({
      name: mcpAlertChartConfigNameSchema,
      where: rejectedRawSqlAlertWhereField,
      whereLanguage: rejectedRawSqlAlertWhereField,
      displayType: z
        .enum(['line', 'stacked_bar', 'stacked_line', 'number'])
        .describe(
          'How to render the SQL results. Alerts evaluate line, stacked_bar, stacked_line, or number charts only.',
        ),
    }),
  ])
  .describe(
    'Chart configuration for inline alerts (required when source is "inline"). ' +
      'Same shape as a dashboard tile config, limited to displayType line, ' +
      'stacked_bar, stacked_line, or number. Omit configType for the builder variant ' +
      '(sourceId + select); set configType to "sql" for the Raw SQL variant ' +
      '(connectionId + sqlTemplate; the template must use the $__timeFilter ' +
      'and $__timeInterval macros so each evaluation window can be queried).',
  );

const mcpAlertChannelSchema = z
  .object({
    type: z.literal('webhook').describe('Notification channel kind.'),
    webhookId: z
      .string()
      .describe(
        'ID of the webhook to notify. Get it from clickstack_get_webhook, or ' +
          'create one with clickstack_save_webhook.',
      ),
  })
  .describe("A webhook that receives this alert's notifications.");

export const mcpSaveAlertSchema = z.object({
  id: z
    .string()
    .optional()
    .describe(
      'Alert ID from clickstack_get_alert. Omit to create a new alert, ' +
        'provide to update an existing one.',
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
    .describe(
      'Saved search to monitor (required when source is saved_search). Get ' +
        'the ID from clickstack_get_saved_search.',
    ),
  dashboardId: z
    .string()
    .optional()
    .describe(
      'Dashboard containing the tile to monitor (required when source is ' +
        'tile). Get the ID from clickstack_get_dashboard.',
    ),
  tileId: z
    .string()
    .optional()
    .describe(
      'Tile to monitor within the dashboard (required when source is tile). ' +
        'Get the ID from clickstack_get_dashboard with the dashboard ID. Must ' +
        'be a line, stacked line, stacked bar, or number tile.',
    ),
  groupBy: z
    .string()
    .optional()
    .describe(
      'Saved search alerts only (ignored for other sources): a column or ' +
        'expression, e.g. ServiceName, that splits the matching-event count ' +
        'into one series per value. Each group is checked against the ' +
        'threshold and tracked separately. Tile and inline alerts group via ' +
        'their chart config instead.',
    ),
  chartConfig: mcpAlertChartConfigSchema.optional(),

  // Threshold
  threshold: z
    .number()
    .describe(
      'Value the alert metric is compared against each interval window. For ' +
        'saved_search alerts the metric is the number of matching events in ' +
        'the window; for tile and inline alerts it is the chart value. Lower ' +
        'bound for between/not_between.',
    ),
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
    .describe(
      'Comparison that fires the alert: above is value >= threshold, ' +
        'above_exclusive is >, below is <, below_or_equal is <=, equal is ===, ' +
        'not_equal is !== (exact match, so avoid them for averaged or rate ' +
        'values). between ' +
        'fires when threshold <= value <= thresholdMax; not_between fires ' +
        'outside that range.',
    ),
  thresholdMax: z
    .number()
    .optional()
    .describe(
      'Upper bound of the range for between/not_between (required for ' +
        'those, must be >= threshold). Ignored and cleared for other ' +
        'threshold types.',
    ),

  // Schedule
  interval: z
    .enum(['1m', '5m', '15m', '30m', '1h', '6h', '12h', '1d'])
    .describe(
      'How often the alert is evaluated; also the size of each evaluated ' +
        'time window.',
    ),
  scheduleOffsetMinutes: z
    .number()
    .int()
    .min(0)
    .max(1439)
    .optional()
    .describe(
      'Shifts each evaluation window this many minutes past the interval ' +
        'boundary. Must be less than the interval. Ignored when ' +
        'scheduleStartAt is set.',
    ),
  scheduleStartAt: z
    .string()
    .datetime()
    .nullable()
    .optional()
    .describe(
      'UTC timestamp that evaluation windows are aligned to; when set, ' +
        'scheduleOffsetMinutes is ignored. On update, omit to keep the ' +
        'stored value or send null to clear it.',
    ),

  // Channel
  channel: mcpAlertChannelSchema.optional(),
  channels: z
    .array(mcpAlertChannelSchema)
    .min(1)
    .max(MAX_ALERT_CHANNELS)
    .optional()
    .describe(
      'Webhooks notified when the alert fires or resolves. Provide this or ' +
        '"channel"; if both, "channel" must match the first entry. Entries ' +
        'must be unique.',
    ),

  // Metadata
  name: z
    .string()
    .min(1)
    .max(512)
    .optional()
    .describe(
      'Handlebars template for the notification title. When omitted, a ' +
        'default title based on the display name is used.',
    ),
  message: z
    .string()
    .min(1)
    .max(4096)
    .optional()
    .describe('Handlebars template for the notification body.'),
  displayName: alertDisplayNameSchema.describe(
    'Display name shown for the alert in the UI. Defaults to the saved search name, dashboard tile name, or inline chartConfig name when omitted. Overridden by the "name" field in alert notifications when provided.',
  ),
  tags: tagsSchema.describe(
    'Tags for the alert. Defaults to the tags of the referenced saved search or dashboard when omitted; inline alerts default to an empty list.',
  ),
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
