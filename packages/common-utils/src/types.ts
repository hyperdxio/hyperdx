import { z } from 'zod';

// Basic Enums
export enum MetricsDataType {
  Gauge = 'gauge',
  Histogram = 'histogram',
  Sum = 'sum',
  Summary = 'summary',
  ExponentialHistogram = 'exponential histogram',
}

export const MetricsDataTypeSchema = z.nativeEnum(MetricsDataType);

/**
 * Controls whether lucene rendering uses ClickHouse text/skip indices
 * (e.g. hasAllTokens()) when matching the implicit column.
 *
 * - `auto` (default): detect a covering text/bloom_filter index at query time
 * - `enabled`: always emit hasAllTokens(), even when no index is detected
 * - `disabled`: never use a text index; fall back to LIKE/hasToken
 */
export enum UseTextIndex {
  Auto = 'auto',
  Enabled = 'enabled',
  Disabled = 'disabled',
}

export const UseTextIndexSchema = z.nativeEnum(UseTextIndex);

// --------------------------
//  UI
// --------------------------
export enum DisplayType {
  Line = 'line',
  StackedBar = 'stacked_bar',
  Table = 'table',
  Pie = 'pie',
  Number = 'number',
  Search = 'search',
  Heatmap = 'heatmap',
  Markdown = 'markdown',
}

export type KeyValue<Key = string, Value = string> = { key: Key; value: Value };

export const MetricTableSchema = z
  .object(
    Object.values(MetricsDataType).reduce(
      (acc, key) => ({
        ...acc,
        [key]: z.string().optional(),
      }),
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- reduce builds complete object at runtime
      {} as Record<MetricsDataType, z.ZodString>,
    ),
  )
  .refine(
    tables => Object.values(tables).some(table => table && table.length > 0),
    { message: 'At least one metric table must be specified' },
  );

export type MetricTable = z.infer<typeof MetricTableSchema>;

export enum NumericUnit {
  // Data
  BytesIEC = 'bytes_iec',
  BytesSI = 'bytes_si',
  BitsIEC = 'bits_iec',
  BitsSI = 'bits_si',
  Kibibytes = 'kibibytes',
  Kilobytes = 'kilobytes',
  Mebibytes = 'mebibytes',
  Megabytes = 'megabytes',
  Gibibytes = 'gibibytes',
  Gigabytes = 'gigabytes',
  Tebibytes = 'tebibytes',
  Terabytes = 'terabytes',
  Pebibytes = 'pebibytes',
  Petabytes = 'petabytes',
  // Data Rate
  PacketsSec = 'packets_sec',
  BytesSecIEC = 'bytes_sec_iec',
  BytesSecSI = 'bytes_sec_si',
  BitsSecIEC = 'bits_sec_iec',
  BitsSecSI = 'bits_sec_si',
  KibibytesSec = 'kibibytes_sec',
  KibibitsSec = 'kibibits_sec',
  KilobytesSec = 'kilobytes_sec',
  KilobitsSec = 'kilobits_sec',
  MebibytesSec = 'mebibytes_sec',
  MebibitsSec = 'mebibits_sec',
  MegabytesSec = 'megabytes_sec',
  MegabitsSec = 'megabits_sec',
  GibibytesSec = 'gibibytes_sec',
  GibibitsSec = 'gibibits_sec',
  GigabytesSec = 'gigabytes_sec',
  GigabitsSec = 'gigabits_sec',
  TebibytesSec = 'tebibytes_sec',
  TebibitsSec = 'tebibits_sec',
  TerabytesSec = 'terabytes_sec',
  TerabitsSec = 'terabits_sec',
  PebibytesSec = 'pebibytes_sec',
  PebibitsSec = 'pebibits_sec',
  PetabytesSec = 'petabytes_sec',
  PetabitsSec = 'petabits_sec',
  // Throughput
  Cps = 'cps',
  Ops = 'ops',
  Rps = 'rps',
  ReadsSec = 'reads_sec',
  Wps = 'wps',
  Iops = 'iops',
  Cpm = 'cpm',
  Opm = 'opm',
  RpmReads = 'rpm_reads',
  Wpm = 'wpm',
}

export const NumberFormatSchema = z.object({
  output: z.enum([
    'currency',
    'percent',
    'byte', // legacy, treated as data/bytes_iec
    'time',
    'duration',
    'number',
    'data_rate',
    'throughput',
  ]),
  numericUnit: z.nativeEnum(NumericUnit).optional(),
  mantissa: z.number().int().optional(),
  thousandSeparated: z.boolean().optional(),
  average: z.boolean().optional(),
  decimalBytes: z.boolean().optional(),
  factor: z.number().optional(),
  currencySymbol: z.string().optional(),
  unit: z.string().optional(),
});

export type NumberFormat = z.infer<typeof NumberFormatSchema>;

// --------------------------
//  SQL TYPES
// --------------------------
// TODO: infer types from here and replaces all types in sqlTypes.ts
export const SQLIntervalSchema = z
  .string()
  .regex(/^\d+ (second|minute|hour|day)$/);
export const SearchConditionSchema = z.string();
const SearchConditionRequiredLanguageSchema = z.enum([
  'sql',
  'lucene',
  'promql',
]);
export const SearchConditionLanguageSchema =
  SearchConditionRequiredLanguageSchema.optional();
export const SearchConditionTrimmedLanguageSchema =
  SearchConditionRequiredLanguageSchema.exclude(['promql']).optional();
export const AggregateFunctionSchema = z.enum([
  'avg',
  'count',
  'count_distinct',
  'last_value',
  'max',
  'min',
  'quantile',
  'sum',
  'any',
  'none',
  // 'increase' is only valid for Sum (counter) metrics. It returns the
  // per-bucket increase of the counter, accounting for counter resets.
  'increase',
]);
export const InternalAggregateFunctionSchema = z.enum([
  ...AggregateFunctionSchema.options,
  // Not exposed to the user directly, but used in pre-built dashboards
  'histogram',
]);
export const AggregateFunctionWithCombinatorsSchema = z
  .string()
  .regex(/^(\w+)If(State|Merge)$/);

// When making changes here, consider if they need to be made to the external API
// schema as well (packages/api/src/utils/zod.ts).
export const RootValueExpressionSchema = z
  .object({
    aggFn: z.union([
      z.literal('quantile'),
      z.literal('quantileMerge'),
      z.literal('histogram'),
      z.literal('histogramMerge'),
    ]),
    level: z.number(),
    aggCondition: SearchConditionSchema,
    aggConditionLanguage: SearchConditionLanguageSchema,
    valueExpression: z.string(),
    valueExpressionLanguage: z.undefined().optional(),
    isDelta: z.boolean().optional(),
  })
  .or(
    z.object({
      aggFn: z.union([
        AggregateFunctionSchema,
        AggregateFunctionWithCombinatorsSchema,
      ]),
      aggCondition: SearchConditionSchema,
      aggConditionLanguage: SearchConditionLanguageSchema,
      valueExpression: z.string(),
      valueExpressionLanguage: z.undefined().optional(),
      isDelta: z.boolean().optional(),
    }),
  )
  .or(
    z.object({
      aggFn: z.string().optional(),
      aggCondition: z.string().optional(),
      aggConditionLanguage: SearchConditionLanguageSchema,
      valueExpression: z.string(),
      valueExpressionLanguage: z.undefined().optional(),
      metricType: z.nativeEnum(MetricsDataType).optional(),
      isDelta: z.boolean().optional(),
    }),
  )
  // valueExpression may be a lucene condition which will be rendered
  // as SQL if valueExpressionLanguage is 'lucene'.
  .or(
    z.object({
      aggFn: z.string().optional(),
      aggCondition: z.string().optional(),
      aggConditionLanguage: SearchConditionLanguageSchema.optional(),
      valueExpression: z.string(),
      valueExpressionLanguage: SearchConditionLanguageSchema,
      isDelta: z.boolean().optional(),
    }),
  );
export const DerivedColumnSchema = z.intersection(
  RootValueExpressionSchema,
  z.object({
    alias: z.string().optional(),
    metricType: z.nativeEnum(MetricsDataType).optional(),
    metricName: z.string().optional(),
    metricNameSql: z.string().optional(),
    // Heatmap-specific fields (optional, only used when displayType is Heatmap)
    countExpression: z.string().optional(),
    heatmapScaleType: z.enum(['log', 'linear']).optional(),
    numberFormat: NumberFormatSchema.optional(),
  }),
);
export const SelectListSchema = z.array(DerivedColumnSchema).or(z.string());
export const SortSpecificationSchema = z.intersection(
  RootValueExpressionSchema,
  z.object({
    ordering: z.enum(['ASC', 'DESC']),
  }),
);
export const SortSpecificationListSchema = z
  .array(SortSpecificationSchema)
  .or(z.string());
export const LimitSchema = z.object({
  limit: z.number().optional(),
  offset: z.number().optional(),
});

export const ChSqlSchema = z.object({
  sql: z.string(),
  params: z.record(z.string(), z.any()),
});

// When making changes here, consider if they need to be made to the external API
// schema as well (packages/api/src/utils/zod.ts).
export const SelectSQLStatementSchema = z.object({
  select: SelectListSchema,
  from: z.object({
    databaseName: z.string(),
    tableName: z.string(),
  }),
  where: SearchConditionSchema,
  whereLanguage: SearchConditionLanguageSchema,
  groupBy: SelectListSchema.optional(),
  having: SearchConditionSchema.optional(),
  havingLanguage: SearchConditionLanguageSchema.optional(),
  orderBy: SortSpecificationListSchema.optional(),
  limit: LimitSchema.optional(),
  // Nullish (not just optional): the chart editor clears the value to `null`
  // so the cleared state survives JSON round-tripping (e.g. through the URL
  // query state). `null` and `undefined` both mean "disabled" downstream.
  seriesLimit: z.number().int().positive().nullish(),
});

export type SQLInterval = z.infer<typeof SQLIntervalSchema>;

export type SearchCondition = z.infer<typeof SearchConditionSchema>;
export type SearchConditionLanguage = z.infer<
  typeof SearchConditionLanguageSchema
>;
export type AggregateFunction = z.infer<typeof AggregateFunctionSchema>;
export type InternalAggregateFunction = z.infer<
  typeof InternalAggregateFunctionSchema
>;
export type AggregateFunctionWithCombinators = z.infer<
  typeof AggregateFunctionWithCombinatorsSchema
>;

export type DerivedColumn = z.infer<typeof DerivedColumnSchema>;

export type SelectList = z.infer<typeof SelectListSchema>;

export type SortSpecificationList = z.infer<typeof SortSpecificationListSchema>;

type Limit = { limit?: number; offset?: number };

export type SelectSQLStatement = {
  select: SelectList;
  from: { databaseName: string; tableName: string };
  where: SearchCondition;
  whereLanguage?: SearchConditionLanguage;
  groupBy?: SelectList;
  having?: SearchCondition;
  havingLanguage?: SearchConditionLanguage;
  orderBy?: SortSpecificationList;
  limit?: Limit;
};

// -------------------------
// EXCEPTIONS
// -------------------------
export type StacktraceFrame = {
  filename: string;
  function: string;
  module?: string;
  lineno: number;
  colno: number;
  in_app: boolean;
  context_line?: string;
  pre_context?: string[];
  post_context?: string[];
};

export type StacktraceBreadcrumbCategory =
  | 'ui.click'
  | 'fetch'
  | 'xhr'
  | 'console'
  | 'navigation'
  | string;

export type StacktraceBreadcrumb = {
  type?: string;
  level?: string;
  event_id?: string;
  category?: StacktraceBreadcrumbCategory;
  message?: string;
  data?: { [key: string]: any };
  timestamp: number;
};

// -------------------------
// WEBHOOKS
// -------------------------
export enum WebhookService {
  Slack = 'slack',
  Generic = 'generic',
  IncidentIO = 'incidentio',
}

/**
 * Base webhook schema (matches backend IWebhook but with JSON-serialized types).
 * When making changes here, consider if they need to be made to the external
 * API schema as well (packages/api/src/utils/zod.ts).
 *
 * NOTE: The internal API (`GET/POST/PUT /api/webhooks`) returns masked values:
 *   - `url`         → `<origin>/****`  (path hidden, may embed tokens)
 *   - `headers`     → keys preserved, every value replaced with `****`
 *   - `queryParams` → keys preserved, every value replaced with `****`
 * The external API v2 returns `url` in plaintext but omits `headers` and
 * `queryParams` entirely via separate Zod schemas in `packages/api/src/utils/zod.ts`.
 */
export const WebhookSchema = z.object({
  _id: z.string(),
  createdAt: z.string(),
  name: z.string(),
  service: z.nativeEnum(WebhookService),
  updatedAt: z.string(),
  url: z
    .string()
    .optional()
    .describe(
      'Internal API returns masked value (<origin>/****). PUT accepts the masked form to preserve the stored URL.',
    ),
  description: z.string().optional(),
  queryParams: z
    .record(z.string(), z.string())
    .optional()
    .describe(
      'Internal API returns keys with values replaced by ****. PUT merges **** back to stored values.',
    ),
  headers: z
    .record(z.string(), z.string())
    .optional()
    .describe(
      'Internal API returns keys with values replaced by ****. PUT merges **** back to stored values.',
    ),
  body: z.string().optional(),
});

export type IWebhook = z.infer<typeof WebhookSchema>;

// Webhook API response type (excludes team field for security)
export type WebhookApiData = Omit<IWebhook, 'team'>;

// -------------------------
// ALERTS
// -------------------------
export enum AlertThresholdType {
  ABOVE = 'above',
  BELOW = 'below',
  ABOVE_EXCLUSIVE = 'above_exclusive',
  BELOW_OR_EQUAL = 'below_or_equal',
  EQUAL = 'equal',
  NOT_EQUAL = 'not_equal',
  BETWEEN = 'between',
  NOT_BETWEEN = 'not_between',
}

export const isRangeThresholdType = (type: string): boolean =>
  type === AlertThresholdType.BETWEEN ||
  type === AlertThresholdType.NOT_BETWEEN;

export enum AlertState {
  ALERT = 'ALERT',
  DISABLED = 'DISABLED',
  INSUFFICIENT_DATA = 'INSUFFICIENT_DATA',
  OK = 'OK',
}

export enum AlertErrorType {
  QUERY_ERROR = 'QUERY_ERROR',
  WEBHOOK_ERROR = 'WEBHOOK_ERROR',
  INVALID_ALERT = 'INVALID_ALERT',
  UNKNOWN = 'UNKNOWN',
}

export const AlertErrorSchema = z.object({
  timestamp: z.union([z.string(), z.date()]),
  type: z.nativeEnum(AlertErrorType),
  message: z.string(),
});

export type AlertError = z.infer<typeof AlertErrorSchema>;

export enum AlertSource {
  SAVED_SEARCH = 'saved_search',
  TILE = 'tile',
}

export const AlertIntervalSchema = z.union([
  z.literal('1m'),
  z.literal('5m'),
  z.literal('15m'),
  z.literal('30m'),
  z.literal('1h'),
  z.literal('6h'),
  z.literal('12h'),
  z.literal('1d'),
]);

export type AlertInterval = z.infer<typeof AlertIntervalSchema>;

export const ALERT_INTERVAL_TO_MINUTES: Record<AlertInterval, number> = {
  '1m': 1,
  '5m': 5,
  '15m': 15,
  '30m': 30,
  '1h': 60,
  '6h': 360,
  '12h': 720,
  '1d': 1440,
};

export const zAlertChannelType = z.literal('webhook');

export type AlertChannelType = z.infer<typeof zAlertChannelType>;

export const zAlertChannel = z.object({
  type: zAlertChannelType,
  webhookId: z.string().nonempty("Webhook ID can't be empty"),
});

export const zSavedSearchAlert = z.object({
  source: z.literal(AlertSource.SAVED_SEARCH),
  groupBy: z.string().optional(),
  savedSearchId: z.string().min(1),
});

export const zTileAlert = z.object({
  source: z.literal(AlertSource.TILE),
  tileId: z.string().min(1),
  dashboardId: z.string().min(1),
});

export const validateAlertScheduleOffsetMinutes = (
  alert: {
    interval: AlertInterval;
    scheduleOffsetMinutes?: number;
    scheduleStartAt?: string | Date | null;
  },
  ctx: z.RefinementCtx,
) => {
  const scheduleOffsetMinutes = alert.scheduleOffsetMinutes ?? 0;
  const intervalMinutes = ALERT_INTERVAL_TO_MINUTES[alert.interval];

  if (alert.scheduleStartAt != null && scheduleOffsetMinutes > 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message:
        'scheduleOffsetMinutes must be 0 when scheduleStartAt is provided',
      path: ['scheduleOffsetMinutes'],
    });
  }

  if (scheduleOffsetMinutes >= intervalMinutes) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `scheduleOffsetMinutes must be less than ${intervalMinutes} minute${intervalMinutes === 1 ? '' : 's'}`,
      path: ['scheduleOffsetMinutes'],
    });
  }
};

export const validateAlertThresholdMax = (
  alert: {
    thresholdType: AlertThresholdType;
    threshold: number;
    thresholdMax?: number;
  },
  ctx: z.RefinementCtx,
) => {
  if (isRangeThresholdType(alert.thresholdType)) {
    if (alert.thresholdMax == null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          'thresholdMax is required for between/not_between threshold types',
        path: ['thresholdMax'],
      });
    } else if (alert.thresholdMax < alert.threshold) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'thresholdMax must be greater than or equal to threshold',
        path: ['thresholdMax'],
      });
    }
  }
};

const MAX_SCHEDULE_START_AT_FUTURE_MS = 1000 * 60 * 60 * 24 * 365;
const MAX_SCHEDULE_START_AT_PAST_MS = 1000 * 60 * 60 * 24 * 365 * 10;
const MAX_SCHEDULE_OFFSET_MINUTES = 1439;

export const scheduleStartAtSchema = z
  .union([z.string().datetime(), z.null()])
  .optional()
  .refine(
    value =>
      value == null ||
      new Date(value).getTime() <= Date.now() + MAX_SCHEDULE_START_AT_FUTURE_MS,
    {
      message: 'scheduleStartAt must be within 1 year from now',
    },
  )
  .refine(
    value =>
      value == null ||
      new Date(value).getTime() >= Date.now() - MAX_SCHEDULE_START_AT_PAST_MS,
    {
      message: 'scheduleStartAt must be within 10 years in the past',
    },
  );

export const alertNoteSchema = z.string().min(1).max(4096).nullish();

export const AlertBaseObjectSchema = z.object({
  id: z.string().optional(),
  interval: AlertIntervalSchema,
  scheduleOffsetMinutes: z
    .number()
    .int()
    .min(0)
    .max(MAX_SCHEDULE_OFFSET_MINUTES)
    .optional(),
  scheduleStartAt: scheduleStartAtSchema,
  threshold: z.number(),
  thresholdType: z.nativeEnum(AlertThresholdType),
  thresholdMax: z.number().optional(),
  channel: zAlertChannel,
  state: z.nativeEnum(AlertState).optional(),
  name: z.string().min(1).max(512).nullish(),
  message: z.string().min(1).max(4096).nullish(),
  note: alertNoteSchema,
  silenced: z
    .object({
      by: z.string(),
      at: z.string(),
      until: z.string(),
    })
    .optional(),
});

// Keep AlertBaseSchema as a ZodObject for backwards compatibility with
// external consumers that call object helpers like .extend()/.pick()/.omit().
export const AlertBaseSchema = AlertBaseObjectSchema;

const AlertBaseValidatedSchema = AlertBaseObjectSchema.superRefine(
  validateAlertScheduleOffsetMinutes,
).superRefine(validateAlertThresholdMax);

export const ChartAlertBaseSchema = AlertBaseObjectSchema.extend({
  threshold: z.number(),
});

const ChartAlertBaseValidatedSchema = ChartAlertBaseSchema.superRefine(
  validateAlertScheduleOffsetMinutes,
).superRefine(validateAlertThresholdMax);

export const AlertSchema = z.union([
  z.intersection(AlertBaseValidatedSchema, zSavedSearchAlert),
  z.intersection(ChartAlertBaseValidatedSchema, zTileAlert),
]);

export type Alert = z.infer<typeof AlertSchema>;

export const AlertHistorySchema = z.object({
  counts: z.number(),
  createdAt: z.string(),
  lastValues: z.array(z.object({ startTime: z.string(), count: z.number() })),
  state: z.nativeEnum(AlertState),
});

export type AlertHistory = z.infer<typeof AlertHistorySchema>;

// --------------------------
// FILTERS
// --------------------------
export const SqlAstFilterSchema = z.object({
  type: z.literal('sql_ast'),
  operator: z.enum(['=', '<', '>', '!=', '<=', '>=']),
  left: z.string(),
  right: z.string(),
});

export type SqlAstFilter = z.infer<typeof SqlAstFilterSchema>;

export const FilterSchema = z.union([
  z.object({
    type: z.enum(['lucene', 'sql']),
    condition: z.string(),
  }),
  SqlAstFilterSchema,
]);

export type Filter = z.infer<typeof FilterSchema>;

// --------------------------
// SAVED SEARCH
// --------------------------
export const SavedSearchSchema = z.object({
  id: z.string(),
  name: z.string(),
  select: z.string(),
  where: z.string(),
  whereLanguage: SearchConditionLanguageSchema,
  source: z.string(),
  tags: z.array(z.string()),
  orderBy: z.string().optional(),
  filters: z.array(FilterSchema).optional(),
  alerts: z.array(AlertSchema).optional(),
});

export type SavedSearch = z.infer<typeof SavedSearchSchema>;

const PopulatedUserSchema = z
  .object({ email: z.string(), name: z.string().optional() })
  .optional();

export const SavedSearchListApiResponseSchema = SavedSearchSchema.omit({
  alerts: true,
}).extend({
  alerts: z
    .array(
      AlertSchema.and(
        z.object({
          createdBy: PopulatedUserSchema,
        }),
      ),
    )
    .optional(),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
  createdBy: PopulatedUserSchema,
  updatedBy: PopulatedUserSchema,
});

export type SavedSearchListApiResponse = z.infer<
  typeof SavedSearchListApiResponseSchema
>;

// --------------------------
// PINNED FILTERS
// --------------------------
export const PinnedFiltersValueSchema = z
  .record(
    z.string().max(1024),
    z.array(z.union([z.string().max(1024), z.boolean()])).max(50),
  )
  .refine(val => Object.keys(val).length <= 100, {
    message: 'Too many filter keys (max 100)',
  });
export type PinnedFiltersValue = z.infer<typeof PinnedFiltersValueSchema>;

export const PinnedFilterSchema = z.object({
  id: z.string(),
  source: z.string(),
  fields: z.array(z.string().max(1024)).max(100),
  filters: PinnedFiltersValueSchema,
});
export type PinnedFilter = z.infer<typeof PinnedFilterSchema>;

// --------------------------
// DASHBOARDS
// --------------------------

export const OnClickFilterTemplateSchema = z.object({
  kind: z.literal('expressionTemplate'),
  expression: z.string().min(1, 'Expression is required').max(10000),
  template: z.string().min(1, 'Template is required').max(10000),
});
export type OnClickFilterTemplate = z.infer<typeof OnClickFilterTemplateSchema>;

const OnClickTargetSchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('id'), id: z.string().min(1) }),
  z.object({
    mode: z.literal('template'),
    template: z.string().min(1).max(10000),
  }),
]);
export type OnClickTarget = z.infer<typeof OnClickTargetSchema>;

export const OnClickSearchSchema = z.object({
  type: z.literal('search'),
  target: OnClickTargetSchema,
  whereTemplate: z.string().max(10000).optional(),
  whereLanguage: SearchConditionLanguageSchema,
  filters: z.array(OnClickFilterTemplateSchema).max(50).optional(),
});
export type OnClickSearch = z.infer<typeof OnClickSearchSchema>;

export const OnClickDashboardSchema = z.object({
  type: z.literal('dashboard'),
  target: OnClickTargetSchema,
  whereTemplate: z.string().max(10000).optional(),
  whereLanguage: SearchConditionLanguageSchema,
  filters: z.array(OnClickFilterTemplateSchema).max(50).optional(),
});
export type OnClickDashboard = z.infer<typeof OnClickDashboardSchema>;

export const OnClickSchema = z.discriminatedUnion('type', [
  OnClickSearchSchema,
  OnClickDashboardSchema,
]);
export type OnClick = z.infer<typeof OnClickSchema>;

export type OnClickSearchById = OnClickSearch & {
  target: Extract<OnClickTarget, { mode: 'id' }>;
};

export type OnClickDashboardById = OnClickDashboard & {
  target: Extract<OnClickTarget, { mode: 'id' }>;
};

/** True when the onClick links by concrete ID to a search source. */
export function isOnClickSearchById(
  onClick: OnClick | undefined,
): onClick is OnClickSearchById {
  return (
    onClick !== undefined &&
    onClick.type === 'search' &&
    onClick.target.mode === 'id'
  );
}

/** True when the onClick links by concrete ID to a dashboard. */
export function isOnClickDashboardById(
  onClick: OnClick | undefined,
): onClick is OnClickDashboardById {
  return (
    onClick !== undefined &&
    onClick.type === 'dashboard' &&
    onClick.target.mode === 'id'
  );
}

/**
 * The set of palette tokens a user can pick for chart series colors,
 * number-tile colors, reference lines, and threshold rules.
 *
 * Tokens map to CSS variables in
 * `packages/app/src/theme/themes/<theme>/_tokens.scss`:
 *   chart-{hue}                 -> --color-chart-{hue}                    (10 hues, unified across themes)
 *   chart-success/warning/error -> --color-chart-{success|warning|error}  (semantic; unified across brands)
 *
 * `chart-info` is a render-time CSS variable (defined in the shared
 * `chart-semantic-tokens` SCSS mixin) but is intentionally *not* in the
 * picker enum; it's consumed only by code paths that always want
 * brand-primary (e.g. info-level log series, `getChartColorInfo()`).
 *
 * Storing tokens (not hex) lets user choices reflow correctly across
 * themes and color modes; see notes/repo-conventions/hyperdx/tile-styling.md.
 *
 * Lives in common-utils because the schema is shared between the app
 * and the API; the theme-aware CSS resolver (`getColorFromCSSToken`)
 * stays in `packages/app/src/utils.ts` because it depends on
 * `getComputedStyle(document.documentElement)`.
 */
/** Categorical tokens (10 hues). Tuple literal so the element type
 * stays narrow (`'chart-blue' | 'chart-orange' | ...`) rather than
 * widening to `ChartPaletteToken`; downstream consumers like
 * `CATEGORICAL_HEX_BY_TOKEN` in `packages/app/src/utils.ts` rely on
 * the narrow element type to enforce 1:1 coverage at compile time. */
export const CATEGORICAL_PALETTE_TOKENS = [
  'chart-blue',
  'chart-orange',
  'chart-red',
  'chart-cyan',
  'chart-green',
  'chart-pink',
  'chart-purple',
  'chart-light-blue',
  'chart-brown',
  'chart-gray',
] as const;

/** Semantic tokens (success / warning / error). Tuple literal for the
 * same narrow-element-type reason as the categorical list above. */
export const SEMANTIC_PALETTE_TOKENS = [
  'chart-success',
  'chart-warning',
  'chart-error',
] as const;

export const CHART_PALETTE_TOKENS = [
  ...CATEGORICAL_PALETTE_TOKENS,
  ...SEMANTIC_PALETTE_TOKENS,
] as const;

export type ChartPaletteToken = (typeof CHART_PALETTE_TOKENS)[number];

/** Numeric tokens (`chart-1` .. `chart-10`) shipped in #2265. */
type LegacyChartPaletteTokenKey =
  | 'chart-1'
  | 'chart-2'
  | 'chart-3'
  | 'chart-4'
  | 'chart-5'
  | 'chart-6'
  | 'chart-7'
  | 'chart-8'
  | 'chart-9'
  | 'chart-10';

/**
 * Legacy numeric tokens (`chart-1` .. `chart-10`) shipped in the initial
 * release of the number-tile color picker (#2265). Renamed to hue-named
 * tokens here to make stored configs and the external API schema
 * self-documenting; mapped at parse time so saved tiles keep working.
 *
 * Mapping preserves the HyperDX slot ordering from #2265 (slot 1 was
 * brand green, slot 2 was blue, and so on through the Observable 10
 * palette).
 *
 * ⚠️ ClickStack caveat: pre-rename ClickStack resolved `--color-chart-1`
 * to brand blue, not brand green, so a ClickStack tile saved with the
 * old "Color 1" will visually shift after migration. The trade-off
 * (and why we don't theme-branch this map) is documented in
 * `agent_docs/data_viz_colors.md` and the changeset for #2362.
 *
 * Keyed by the narrow `LegacyChartPaletteTokenKey` union (rather than
 * `string`) so a typo in a legacy slot at edit time becomes a compile
 * error.
 */
export const LEGACY_CHART_PALETTE_TOKEN_MAP = {
  'chart-1': 'chart-green',
  'chart-2': 'chart-blue',
  'chart-3': 'chart-orange',
  'chart-4': 'chart-red',
  'chart-5': 'chart-cyan',
  'chart-6': 'chart-pink',
  'chart-7': 'chart-purple',
  'chart-8': 'chart-light-blue',
  'chart-9': 'chart-brown',
  'chart-10': 'chart-gray',
} as const satisfies Record<LegacyChartPaletteTokenKey, ChartPaletteToken>;

export type LegacyChartPaletteToken =
  keyof typeof LEGACY_CHART_PALETTE_TOKEN_MAP;

/** Type guard for runtime validation of an unknown token string. */
export function isChartPaletteToken(
  value: unknown,
): value is ChartPaletteToken {
  return (
    typeof value === 'string' &&
    (CHART_PALETTE_TOKENS as readonly string[]).includes(value)
  );
}

function isLegacyChartPaletteToken(
  value: unknown,
): value is LegacyChartPaletteToken {
  return (
    typeof value === 'string' &&
    Object.prototype.hasOwnProperty.call(LEGACY_CHART_PALETTE_TOKEN_MAP, value)
  );
}

/**
 * Resolve any string to a canonical `ChartPaletteToken`, accepting both
 * current hue-named tokens and legacy numeric tokens (`chart-1` ..
 * `chart-10`) from #2265. Returns `undefined` for anything else.
 *
 * Use this at every render-time consumption point (dashboard tile
 * renderers like `DBNumberChart`, the color picker's `safeValue` guard
 * in `ColorSwatchInput`, etc.). The app's normalizer
 * (`normalizeDashboardTileColors` in `packages/app/src/dashboard.ts`)
 * heals dashboards both on fetch (`useDashboards` /
 * `fetchLocalDashboards`) and on write (`useUpdateDashboard` /
 * `useCreateDashboard`), so the DB-side data converges on next save
 * and JSON imports / preset constructions don't trip the strict
 * `ChartPaletteTokenSchema`. Render-time consumers still call this
 * helper as defense in depth for tiles built in memory between fetch
 * and save (`ChartEditor` form state, unit-test fixtures).
 */
export function resolveChartPaletteToken(
  value: unknown,
): ChartPaletteToken | undefined {
  if (typeof value !== 'string') return undefined;
  if (isLegacyChartPaletteToken(value)) {
    return LEGACY_CHART_PALETTE_TOKEN_MAP[value];
  }
  return isChartPaletteToken(value) ? value : undefined;
}

/**
 * Walk a parsed-but-not-yet-typed dashboard payload and yield each
 * `tiles[i].config.color` that holds a string, asking `onColor` what
 * the new value should be. The walker is the single shared
 * implementation behind:
 *   - the React app's fetch- / write-time normalizer
 *     (`normalizeDashboardTileColors` in `packages/app/src/dashboard.ts`)
 *   - the JSON-import pre-validation pass
 *     (`normalizeRawDashboardTileColors`, same file)
 *   - the API dashboards route middleware
 *     (`migrateLegacyDashboardTileColors` in
 *     `packages/api/src/routers/api/dashboards.ts`)
 *   - the dashboard-provisioner task
 *     (`packages/api/src/tasks/provisionDashboards/index.ts`)
 *
 * `onColor` receives the current string and returns one of:
 *   - `undefined` → strip the `color` field from that tile's config.
 *   - a string identical to `current` → leave the tile untouched
 *     (preserves referential identity so React reconciliation stays
 *     cheap).
 *   - a different string → rewrite `config.color` to the new value.
 *
 * Returns the (possibly new) `input` reference. When nothing changed,
 * the same `input` is returned so `===` callers can short-circuit.
 * Inputs that aren't an object, or whose `tiles` isn't an array, are
 * returned unchanged.
 */
export function walkRawDashboardTileColors(
  input: unknown,
  onColor: (current: string) => string | undefined,
): unknown {
  if (!input || typeof input !== 'object') return input;
  const root = input as { tiles?: unknown };
  const tiles = root.tiles;
  if (!Array.isArray(tiles)) return input;
  let changed = false;
  const nextTiles = (tiles as unknown[]).map(tile => {
    if (!tile || typeof tile !== 'object') return tile;
    const t = tile as { config?: unknown };
    const config = t.config;
    if (!config || typeof config !== 'object') return tile;
    const c = config as { color?: unknown };
    const current = c.color;
    if (typeof current !== 'string') return tile;
    const next = onColor(current);
    if (next === current) return tile;
    changed = true;
    if (next === undefined) {
      const { color: _drop, ...rest } = c;
      return { ...t, config: rest };
    }
    return { ...t, config: { ...c, color: next } };
  });
  return changed ? { ...root, tiles: nextTiles } : input;
}

/**
 * Strict Zod schema for the curated palette tokens. Intentionally
 * does NOT accept legacy numeric tokens (`chart-1` .. `chart-10`)
 * from #2265. Wrapping the enum in `z.preprocess` would force the
 * schema's input type to `unknown`, which breaks downstream `z.infer`
 * consumers (e.g. `validateRequest` in the API handlers infers
 * `req.body` as `unknown` for any field reached through this schema).
 *
 * Legacy data is healed at load time instead: see
 * `normalizeDashboardTileColors` in `packages/app/src/dashboard.ts`,
 * which walks `tiles[i].config.color` and replaces any legacy token
 * with its hue-named equivalent via `resolveChartPaletteToken`.
 * Render-time consumers also call `resolveChartPaletteToken` as
 * belt-and-suspenders against any data path that bypasses the
 * fetch-time normalizer.
 */
export const ChartPaletteTokenSchema = z.enum(CHART_PALETTE_TOKENS);

/**
 * A single conditional color rule. Rules are evaluated in order against
 * the tile's displayed value; the LAST matching rule's color wins
 * (last-match-wins: higher-priority rules go last). If no rule matches,
 * the tile's static `color` applies; if that is unset, the default text
 * color applies.
 *
 * String operators (`contains`, `startsWith`, `endsWith`, `regex`) are
 * included at the schema level so a future table-tile slice can reuse
 * the same type without a schema change. The number-tile UI only exposes
 * numeric / equality operators.
 *
 * Lives in common-utils so both the app and a future external-API parity
 * PR can import it.
 */
// Numeric ordered operators (gt | gte | lt | lte).
const numericOrderedColorCondition = z.object({
  operator: z.enum(['gt', 'gte', 'lt', 'lte']),
  value: z.number().finite(),
  color: ChartPaletteTokenSchema,
  label: z.string().max(40).optional(),
});

const betweenColorCondition = z.object({
  operator: z.literal('between'),
  value: z.tuple([z.number().finite(), z.number().finite()]),
  color: ChartPaletteTokenSchema,
  label: z.string().max(40).optional(),
});

// Equality against a number or a string value.
const equalityColorCondition = z.object({
  operator: z.enum(['eq', 'neq']),
  value: z.union([z.number().finite(), z.string().max(200)]),
  color: ChartPaletteTokenSchema,
  label: z.string().max(40).optional(),
});

// String-match operators, kept at the schema level only for a future
// table-tile slice (see the doc comment above). The number-tile editor
// never emits these.
const stringMatchColorCondition = z.object({
  operator: z.enum(['contains', 'startsWith', 'endsWith']),
  value: z.string().min(1).max(200),
  color: ChartPaletteTokenSchema,
  label: z.string().max(40).optional(),
});

const regexColorCondition = z.object({
  operator: z.literal('regex'),
  value: z
    .string()
    .min(1)
    .max(500)
    .refine(
      v => {
        try {
          new RegExp(v);
          return true;
        } catch {
          return false;
        }
      },
      { message: 'Invalid regex pattern' },
    ),
  color: ChartPaletteTokenSchema,
  label: z.string().max(40).optional(),
});

export const ColorConditionSchema = z.discriminatedUnion('operator', [
  numericOrderedColorCondition,
  betweenColorCondition,
  equalityColorCondition,
  stringMatchColorCondition,
  regexColorCondition,
]);

export type ColorCondition = z.infer<typeof ColorConditionSchema>;

/**
 * The subset of color-rule operators the number-tile editor actually
 * emits (`ColorRulesEditor.tsx` OPERATOR_OPTIONS: gt, gte, lt, lte,
 * between, eq, neq). The external dashboards API and the MCP dashboard
 * tool validate number-tile `colorRules` against this schema rather than
 * the full `ColorConditionSchema`, so the authoring surface cannot accept
 * the string-match or regex rules the UI can never produce (a stored
 * regex would be compiled and evaluated at render time). Keep the operator
 * set in sync with the editor's options.
 */
export const NumberTileColorConditionSchema = z.discriminatedUnion('operator', [
  numericOrderedColorCondition,
  betweenColorCondition,
  equalityColorCondition,
]);

export type NumberTileColorCondition = z.infer<
  typeof NumberTileColorConditionSchema
>;

/**
 * Optional background trend ("sparkline") drawn behind a number tile's
 * value. Derived from a time-bucketed version of the same query, so the
 * value's trend over the selected range is visible at a glance (useful for
 * SLO / error-budget tiles, where burn is temporal).
 *
 * `type` picks the shape (`line` or `area`). `color` is an optional
 * palette-token override; when unset the sparkline inherits the tile's
 * static `color`. Number tiles only; the UI gates the control on a builder
 * config (raw SQL number tiles return a single value with no time
 * dimension to bucket). Lives in common-utils so both the app and a future
 * external-API parity PR can import it.
 */
export const BackgroundChartSchema = z.object({
  type: z.enum(['line', 'area']),
  color: ChartPaletteTokenSchema.optional(),
});

export type BackgroundChart = z.infer<typeof BackgroundChartSchema>;

// When making changes here, consider if they need to be made to the external API
// as well: the Zod schema (packages/api/src/utils/zod.ts) and the hand-written
// OpenAPI JSDoc (packages/api/src/routers/external-api/v2/dashboards.ts), which
// duplicates this shape for the generated spec.
/**
 * Schema describing settings which are shared between Raw SQL
 * chart configs and Structured ChartBuilder chart configs
 **/
const SharedChartSettingsSchema = z.object({
  displayType: z.nativeEnum(DisplayType).optional(),
  numberFormat: NumberFormatSchema.optional(),
  granularity: z.union([SQLIntervalSchema, z.literal('auto')]).optional(),
  compareToPreviousPeriod: z.boolean().optional(),
  fillNulls: z.union([z.number(), z.literal(false)]).optional(),
  alignDateRangeToGranularity: z.boolean().optional(),
  fitYAxisToData: z.boolean().optional(),
  onClick: OnClickSchema.optional(),
  // Palette-token color override. Applied by the renderer for number
  // tiles only (gated in `ChartDisplaySettingsDrawer`); other display
  // types ignore the field. Other tile types (line / bar / pie) ship
  // their per-series colors in a follow-up PR via `select[i].color`.
  // Stored at shared level mirroring `numberFormat` above, which is
  // also a Number-tile-only field stored at shared level and gated in
  // the UI.
  color: ChartPaletteTokenSchema.optional(),
  // Ordered conditional color rules for number tiles. Last matching rule
  // wins (higher-priority rules go last). Kept at shared level so a future
  // table-tile slice can attach per-column rules without a schema change.
  // The UI gates the section on `displayType === DisplayType.Number`.
  colorRules: z.array(ColorConditionSchema).max(10).optional(),
  // Optional background trend (line / area sparkline) drawn behind a number
  // tile's value, derived from a time-bucketed version of the same query.
  // Number tiles only; the UI gates the control on a builder config (raw SQL
  // number tiles have no time dimension to bucket). Other display types
  // ignore the field. Kept at shared level mirroring `color` / `colorRules`.
  backgroundChart: BackgroundChartSchema.optional(),
});

export const _ChartConfigSchema = SharedChartSettingsSchema.extend({
  timestampValueExpression: z.string(),
  implicitColumnExpression: z.string().optional(),
  // Fallback expression for bare-text Lucene search when no implicit column is
  // set. Threaded through from `bodyExpression` on log sources. Trace sources
  // do not populate this (different semantic for `spanNameExpression`).
  bodyExpression: z.string().optional(),
  useTextIndexForImplicitColumn: UseTextIndexSchema.optional(),
  sampleWeightExpression: z.string().optional(),
  markdown: z.string().optional(),
  filtersLogicalOperator: z.enum(['AND', 'OR']).optional(),
  filters: z.array(FilterSchema).optional(),
  connection: z.string(),
  selectGroupBy: z.boolean().optional(),
  metricTables: MetricTableSchema.optional(),
  seriesReturnType: z.enum(['ratio', 'column']).optional(),
  // Used to preserve original table select string when chart overrides it (e.g., histograms)
  eventTableSelect: z.string().optional(),
  source: z.string().optional(),
  groupByColumnsOnLeft: z.boolean().optional(),
});

// This is a ChartConfig type without the `with` CTE clause included.
// It needs to be a separate, named schema to avoid use of z.lazy(...),
// use of which allows for type mistakes to make it past linting.
export const CteChartConfigSchema = z.intersection(
  _ChartConfigSchema.partial({ timestampValueExpression: true }),
  SelectSQLStatementSchema,
);

export type CteChartConfig = z.infer<typeof CteChartConfigSchema>;

// The `with` CTE property needs to be defined at this level, just above the
// non-recursive chart config so that it can reference a complete chart config
// schema. This structure does mean that we cannot nest `with` clauses but does
// ensure the type system can catch more issues in the build pipeline.
const BuilderChartConfigSchema = z.intersection(
  z.intersection(_ChartConfigSchema, SelectSQLStatementSchema),
  z
    .object({
      with: z.array(
        z.object({
          name: z.string(),

          // Need to specify either a sql or chartConfig instance. To avoid
          // the schema falling into an any type, the fields are separate
          // and listed as optional.
          sql: ChSqlSchema.optional(),
          chartConfig: CteChartConfigSchema.optional(),

          // If true, it'll render as WITH ident AS (subquery)
          // If false, it'll be a "variable" ex. WITH (sql) AS ident
          // where sql can be any expression, ex. a constant string
          // see: https://clickhouse.com/docs/sql-reference/statements/select/with#syntax
          // default assume true
          isSubquery: z.boolean().optional(),
        }),
      ),
    })
    .partial(),
);

export type BuilderChartConfig = z.infer<typeof BuilderChartConfigSchema>;

/** Base schema for Raw SQL chart configs */
const RawSqlBaseChartConfigSchema = SharedChartSettingsSchema.extend({
  configType: z.literal('sql'),
  sqlTemplate: z.string(),
  connection: z.string(),
  source: z.string().optional(),
});

/** Schema describing Raw SQL chart configs with runtime-only fields */
const RawSqlChartConfigSchema = RawSqlBaseChartConfigSchema.extend({
  filters: z.array(FilterSchema).optional(),
  from: z
    .object({ databaseName: z.string(), tableName: z.string() })
    .optional(),
  implicitColumnExpression: z.string().optional(),
  // Same fallback as on `_ChartConfigSchema`; logs-only.
  bodyExpression: z.string().optional(),
  useTextIndexForImplicitColumn: UseTextIndexSchema.optional(),
  metricTables: MetricTableSchema.optional(),
});

export type RawSqlChartConfig = z.infer<typeof RawSqlChartConfigSchema>;

/** Base schema for PromQL chart configs (persisted fields) */
const PromqlBaseChartConfigSchema = SharedChartSettingsSchema.extend({
  configType: z.literal('promql'),
  promqlExpression: z.string(),
  connection: z.string(),
  source: z.string().optional(),
  step: z.string().optional(),
});

/** Schema describing PromQL chart configs with runtime-only fields */
const PromqlChartConfigSchema = PromqlBaseChartConfigSchema.extend({
  filters: z.array(FilterSchema).optional(),
  from: z
    .object({ databaseName: z.string(), tableName: z.string() })
    .optional(),
});

export type PromqlChartConfig = z.infer<typeof PromqlChartConfigSchema>;

export const ChartConfigSchema = z.union([
  BuilderChartConfigSchema,
  RawSqlChartConfigSchema,
  PromqlChartConfigSchema,
]);

export type ChartConfig = z.infer<typeof ChartConfigSchema>;

export type DateRange = {
  dateRange: [Date, Date];
  dateRangeStartInclusive?: boolean; // default true
  dateRangeEndInclusive?: boolean; // default true
  // Runtime-only, set by query chunking when dateRange is narrowed to a
  // window: a fixed ranking range (the newest chunk window) used by the
  // `__hdx_series_limit` CTE so every chunk ranks (and keeps) the same
  // top-N series. Never persisted.
  seriesLimitDateRange?: [Date, Date];
};

export type ChartConfigWithDateRange = ChartConfig & DateRange;
export type BuilderChartConfigWithDateRange = BuilderChartConfig & DateRange;
export type RawSqlConfigWithDateRange = RawSqlChartConfig & DateRange;
export type PromqlConfigWithDateRange = PromqlChartConfig & DateRange;

export type BuilderChartConfigWithOptTimestamp = Omit<
  BuilderChartConfigWithDateRange,
  'timestampValueExpression'
> & {
  timestampValueExpression?: string;
};

export type ChartConfigWithOptTimestamp =
  | BuilderChartConfigWithOptTimestamp
  | RawSqlConfigWithDateRange
  | PromqlConfigWithDateRange;

// For non-time-based searches (ex. grab 1 row)
export type BuilderChartConfigWithOptDateRange = Omit<
  BuilderChartConfig,
  'timestampValueExpression'
> & {
  timestampValueExpression?: string;
} & Partial<DateRange>;

export type ChartConfigWithOptDateRange =
  | BuilderChartConfigWithOptDateRange
  | (RawSqlChartConfig & Partial<DateRange>)
  | (PromqlChartConfig & Partial<DateRange>);

// When making changes here, consider if they need to be made to the external API
// schema as well (packages/api/src/utils/zod.ts).
const BuilderSavedChartConfigWithoutAlertSchema = z
  .object({
    name: z.string().optional(),
    source: z.string(),
  })
  .extend(
    _ChartConfigSchema.omit({
      connection: true,
      timestampValueExpression: true,
      source: true, // Omit the optional source here since it's required above
    }).shape,
  )
  .extend(
    SelectSQLStatementSchema.omit({
      from: true,
    }).shape,
  );

const BuilderSavedChartConfigSchema =
  BuilderSavedChartConfigWithoutAlertSchema.extend({
    alert: z.union([
      AlertBaseSchema.optional(),
      ChartAlertBaseSchema.optional(),
    ]),
  });

export type BuilderSavedChartConfig = z.infer<
  typeof BuilderSavedChartConfigSchema
>;

const RawSqlSavedChartConfigWithoutAlertSchema =
  RawSqlBaseChartConfigSchema.extend({
    name: z.string().optional(),
  });

const RawSqlSavedChartConfigSchema =
  RawSqlSavedChartConfigWithoutAlertSchema.extend({
    alert: z.union([
      AlertBaseSchema.optional(),
      ChartAlertBaseSchema.optional(),
    ]),
  });

const PromqlSavedChartConfigWithoutAlertSchema =
  PromqlBaseChartConfigSchema.extend({
    name: z.string().optional(),
  });

const PromqlSavedChartConfigSchema =
  PromqlSavedChartConfigWithoutAlertSchema.extend({
    alert: z.union([
      AlertBaseSchema.optional(),
      ChartAlertBaseSchema.optional(),
    ]),
  });

export const SavedChartConfigSchema = z.union([
  BuilderSavedChartConfigSchema,
  RawSqlSavedChartConfigSchema,
  PromqlSavedChartConfigSchema,
]);

export type RawSqlSavedChartConfig = z.infer<
  typeof RawSqlSavedChartConfigSchema
>;

export type PromqlSavedChartConfig = z.infer<
  typeof PromqlSavedChartConfigSchema
>;

export type SavedChartConfig = z.infer<typeof SavedChartConfigSchema>;

export const TileSchema = z.object({
  id: z.string(),
  x: z.number(),
  y: z.number(),
  w: z.number(),
  h: z.number(),
  config: SavedChartConfigSchema,
  // `min(1)` matches the external API; an empty string isn't a valid
  // id and would silently pass `tile.containerId !== undefined` checks.
  containerId: z.string().min(1).optional(),
  // For tiles inside a tab container: which tab this tile belongs to
  tabId: z.string().min(1).optional(),
});

export const TileTemplateSchema = TileSchema.extend({
  config: z.union([
    BuilderSavedChartConfigWithoutAlertSchema,
    RawSqlSavedChartConfigWithoutAlertSchema,
    PromqlSavedChartConfigWithoutAlertSchema,
  ]),
});

export type Tile = z.infer<typeof TileSchema>;

// Reasonable bounds on identifiers and titles. The UI never asks the
// user to type either an id or a title longer than ~64 chars; capping
// at 256 leaves room for slugified or composed ids without inviting
// Mongo-doc bloat. Exported so the external-API tile schema can apply
// the same cap to tile.containerId / tile.tabId.
export const DASHBOARD_CONTAINER_ID_MAX = 256;
const DASHBOARD_CONTAINER_TITLE_MAX = 256;
// Caps the per-container tab fan-out. The tab bar visually breaks
// past ~10 tabs and the editor offers no bulk-add affordance. Used
// only by this schema; not exported.
const DASHBOARD_CONTAINER_MAX_TABS = 20;
// Caps the per-dashboard container fan-out.
export const DASHBOARD_MAX_CONTAINERS = 50;
// Caps the per-dashboard tile fan-out. The dashboard editor's add-tile
// affordance is one-at-a-time, but external-API callers can POST a list
// in one request; without a cap a payload could push tens of MB into
// Mongo and run out of memory rendering it.
export const DASHBOARD_MAX_TILES = 500;

export const DashboardContainerTabSchema = z.object({
  id: z.string().min(1).max(DASHBOARD_CONTAINER_ID_MAX),
  title: z.string().min(1).max(DASHBOARD_CONTAINER_TITLE_MAX),
});

export const DashboardContainerSchema = z.object({
  id: z.string().min(1).max(DASHBOARD_CONTAINER_ID_MAX),
  title: z.string().min(1).max(DASHBOARD_CONTAINER_TITLE_MAX),
  collapsed: z.boolean(),
  // Whether the group can be collapsed (default true)
  collapsible: z.boolean().optional(),
  // Whether to show a border around the group (default true)
  bordered: z.boolean().optional(),
  // Optional tabs: 2+ entries → tab bar renders, 0-1 → plain group header.
  // Tiles reference a specific tab via tabId.
  tabs: z
    .array(DashboardContainerTabSchema)
    .max(DASHBOARD_CONTAINER_MAX_TABS)
    .optional(),
});

export type DashboardContainer = z.infer<typeof DashboardContainerSchema>;

export const DashboardFilterType = z.enum(['QUERY_EXPRESSION']);

export const DashboardFilterSchema = z.object({
  id: z.string(),
  type: DashboardFilterType,
  name: z.string().min(1),
  expression: z.string().min(1),
  source: z.string().min(1),
  sourceMetricType: z.nativeEnum(MetricsDataType).optional(),
  where: z.string().optional(),
  whereLanguage: SearchConditionTrimmedLanguageSchema,
  // Sources this filter applies to. Undefined / missing means the filter
  // applies to all tiles.
  appliesToSourceIds: z.array(z.string().min(1)).optional(),
});

export type DashboardFilter = z.infer<typeof DashboardFilterSchema>;

export enum PresetDashboard {
  Services = 'services',
}

export const PresetDashboardFilterSchema = DashboardFilterSchema.extend({
  presetDashboard: z.nativeEnum(PresetDashboard),
});

export type PresetDashboardFilter = z.infer<typeof PresetDashboardFilterSchema>;

export function addDuplicateTileIdIssues(
  tiles: { id?: string }[],
  ctx: z.RefinementCtx,
  options?: { messageSuffix?: string },
) {
  const suffix = options?.messageSuffix ?? '';
  const seen = new Set<string>();
  for (let i = 0; i < tiles.length; i++) {
    const id = tiles[i].id;
    if (!id) continue;
    if (seen.has(id)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Duplicate tile ID: ${id}${suffix}`,
        path: [i, 'id'],
      });
    }
    seen.add(id);
  }
}

// `DashboardSchema` is intentionally left as a `ZodObject` (no parent-level
// `.superRefine`) so existing call sites that chain `.omit()`, `.partial()`,
// or `.extend()` keep working (see `routers/api/dashboards.ts` PATCH body
// and `DashboardWithoutIdSchema` / `DashboardTemplateSchema` below).
// Cross-tile container/tab reference validation lives in
// `./dashboardValidation` and is applied at the external-API request body
// schema (`buildDashboardBodySchema` in `v2/utils/dashboards.ts`), which is
// the only public surface that accepts arbitrary tile + container payloads
// in one call.
export const DashboardSchema = z.object({
  id: z.string(),
  name: z.string().min(1),
  tiles: z.array(TileSchema),
  tags: z.array(z.string()),
  filters: z.array(DashboardFilterSchema).optional(),
  savedQuery: z.string().nullable().optional(),
  savedQueryLanguage: SearchConditionLanguageSchema.nullable().optional(),
  savedFilterValues: z.array(FilterSchema).optional(),
  containers: z
    .array(DashboardContainerSchema)
    .max(DASHBOARD_MAX_CONTAINERS)
    .superRefine((containers, ctx) => {
      const seen = new Set<string>();
      containers.forEach((c, i) => {
        if (seen.has(c.id)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Container IDs must be unique: "${c.id}"`,
            path: [i, 'id'],
          });
        }
        seen.add(c.id);
      });
    })
    .optional(),
});
export const DashboardWithoutIdSchema = DashboardSchema.omit({ id: true });
export type DashboardWithoutId = z.infer<typeof DashboardWithoutIdSchema>;

export const DashboardTemplateSchema = DashboardWithoutIdSchema.omit({
  tags: true,
}).extend({
  version: z.string().min(1),
  description: z.string().optional(),
  tags: z.array(z.string()).optional(),
  tiles: z.array(TileTemplateSchema).superRefine(addDuplicateTileIdIssues),
  filters: z.array(DashboardFilterSchema).optional(),
});
export type DashboardTemplate = z.infer<typeof DashboardTemplateSchema>;

export const ConnectionSchema = z.object({
  id: z.string(),
  name: z.string(),
  host: z.string(),
  username: z.string(),
  password: z.string().optional(),
  hyperdxSettingPrefix: z
    .string()
    .regex(/^[a-z0-9_]+$/i)
    .optional()
    .nullable(),
  prometheusEndpoint: z.string().url().optional(),
});

export type Connection = z.infer<typeof ConnectionSchema>;

export const TeamClickHouseSettingsSchema = z.object({
  fieldMetadataDisabled: z.boolean().optional(),
  searchRowLimit: z.number().optional(),
  queryTimeout: z.number().optional(),
  metadataMaxRowsToRead: z.number().optional(),
  parallelizeWhenPossible: z.boolean().optional(),
  filterKeysFetchLimit: z.number().optional(),
});

/** Accepts null to unset (reset to default) a setting. */
export const TeamClickHouseSettingsUpdateSchema = z.object({
  fieldMetadataDisabled: z.boolean().nullish(),
  searchRowLimit: z.number().nullish(),
  queryTimeout: z.number().nullish(),
  metadataMaxRowsToRead: z.number().nullish(),
  parallelizeWhenPossible: z.boolean().nullish(),
  filterKeysFetchLimit: z.number().nullish(),
});
export type TeamClickHouseSettingsUpdate = z.infer<
  typeof TeamClickHouseSettingsUpdateSchema
>;
export type TeamClickHouseSettings = z.infer<
  typeof TeamClickHouseSettingsSchema
>;

export const TeamSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    allowedAuthMethods: z.array(z.literal('password')).optional(),
    apiKey: z.string(),
    hookId: z.string(),
    collectorAuthenticationEnforced: z.boolean(),
  })
  .merge(TeamClickHouseSettingsSchema);

export type Team = z.infer<typeof TeamSchema>;

// --------------------------
// TABLE SOURCES
// --------------------------
export enum SourceKind {
  Log = 'log',
  Trace = 'trace',
  Session = 'session',
  Metric = 'metric',
  Promql = 'promql',
}

// --------------------------
// TABLE SOURCE FORM VALIDATION
// --------------------------

const QuerySettingsSchema = z
  .array(z.object({ setting: z.string().min(1), value: z.string().min(1) }))
  .max(10);

export type QuerySettings = z.infer<typeof QuerySettingsSchema>;

const RequiredTimestampColumnSchema = z
  .string()
  .min(1, 'Timestamp Column is required');

// Base schema with fields common to all source types
export const BaseSourceSchema = z.object({
  id: z.string(),
  name: z.string().min(1, 'Name is required'),
  section: z.string().max(256).optional(),
  kind: z.nativeEnum(SourceKind),
  connection: z.string().min(1, 'Server Connection is required'),
  from: z.object({
    databaseName: z.string().min(1, 'Database is required'),
    tableName: z.string().min(1, 'Table is required'),
  }),
  disabled: z.boolean().optional(),
  querySettings: QuerySettingsSchema.optional(),
  timestampValueExpression: RequiredTimestampColumnSchema,
});

const HighlightedAttributeExpressionsSchema = z.array(
  z.object({
    sqlExpression: z.string().min(1, 'Attribute SQL Expression is required'),
    luceneExpression: z.string().optional(),
    alias: z.string().optional(),
  }),
);

const AggregatedColumnConfigSchema = z
  .object({
    sourceColumn: z.string().optional(),
    aggFn: InternalAggregateFunctionSchema,
    mvColumn: z.string().min(1, 'Materialized View Column is required'),
  })
  .refine(
    ({ sourceColumn, aggFn }) => aggFn === 'count' || !!sourceColumn?.length,
    { message: 'Materialized View Source Column is required' },
  );

export type AggregatedColumnConfig = z.infer<
  typeof AggregatedColumnConfigSchema
>;

export const MaterializedViewConfigurationSchema = z.object({
  databaseName: z.string().min(1, 'Materialized View Database is required'),
  tableName: z.string().min(1, 'Materialized View Table is required'),
  dimensionColumns: z.string(),
  minGranularity: SQLIntervalSchema,
  minDate: z.string().datetime().nullish(),
  timestampColumn: z
    .string()
    .min(1, 'Materialized View Timestamp column is required'),
  aggregatedColumns: z
    .array(AggregatedColumnConfigSchema)
    .min(1, 'At least one aggregated column is required'),
});

export type MaterializedViewConfiguration = z.infer<
  typeof MaterializedViewConfigurationSchema
>;

export const MetadataMaterializedViewsSchema = z.object({
  keyRollupTable: z.string().min(1, 'Key rollup table name is required'),
  kvRollupTable: z.string().min(1, 'KV rollup table name is required'),
  granularity: SQLIntervalSchema,
});

export type MetadataMaterializedViews = z.infer<
  typeof MetadataMaterializedViewsSchema
>;

// Log source form schema
export const LogSourceSchema = BaseSourceSchema.extend({
  kind: z.literal(SourceKind.Log),
  defaultTableSelectExpression: z
    .string()
    .min(1, 'Default Select Expression is required'),
  // Optional fields for logs
  serviceNameExpression: z.string().optional(),
  severityTextExpression: z.string().optional(),
  bodyExpression: z.string().optional(),
  eventAttributesExpression: z.string().optional(),
  resourceAttributesExpression: z.string().optional(),
  displayedTimestampValueExpression: z.string().optional(),
  metricSourceId: z.string().optional(),
  traceSourceId: z.string().optional(),
  traceIdExpression: z.string().optional(),
  spanIdExpression: z.string().optional(),
  implicitColumnExpression: z.string().optional(),
  /**
   * @deprecated Application-side SQL predicate AND'd into every query against
   * the source. Not a security boundary; bypassable by direct table SELECT.
   * For hard tenant isolation, use a ClickHouse ROW POLICY at the DB level:
   * https://clickhouse.com/docs/sql-reference/statements/create/row-policy
   *
   * Existing values are still honored at query time; new sources should not
   * set it. The Sources settings UI form input is disabled.
   */
  tableFilterExpression: z.string().optional(),
  highlightedTraceAttributeExpressions:
    HighlightedAttributeExpressionsSchema.optional(),
  highlightedRowAttributeExpressions:
    HighlightedAttributeExpressionsSchema.optional(),
  materializedViews: z.array(MaterializedViewConfigurationSchema).optional(),
  metadataMaterializedViews: MetadataMaterializedViewsSchema.optional(),
  orderByExpression: z.string().optional(),
  useTextIndexForImplicitColumn: UseTextIndexSchema.optional(),
});

// Trace source form schema
export const TraceSourceSchema = BaseSourceSchema.extend({
  kind: z.literal(SourceKind.Trace),
  defaultTableSelectExpression: z
    .string()
    .min(1, 'Default Select Expression is required'),

  // Required fields for traces
  durationExpression: z.string().min(1, 'Duration Expression is required'),
  durationPrecision: z.number().min(0).max(9).default(3),
  traceIdExpression: z.string().min(1, 'Trace ID Expression is required'),
  spanIdExpression: z.string().min(1, 'Span ID Expression is required'),
  parentSpanIdExpression: z
    .string()
    .min(1, 'Parent span ID expression is required'),
  spanNameExpression: z.string().min(1, 'Span Name Expression is required'),
  spanKindExpression: z.string().min(1, 'Span Kind Expression is required'),

  // Optional fields for traces
  sampleRateExpression: z.string().optional(),
  logSourceId: z.string().optional().nullable(),
  sessionSourceId: z.string().optional(),
  metricSourceId: z.string().optional(),
  statusCodeExpression: z.string().optional(),
  statusMessageExpression: z.string().optional(),
  serviceNameExpression: z.string().optional(),
  resourceAttributesExpression: z.string().optional(),
  eventAttributesExpression: z.string().optional(),
  spanEventsValueExpression: z.string().optional(),
  implicitColumnExpression: z.string().optional(),
  displayedTimestampValueExpression: z.string().optional(),
  highlightedTraceAttributeExpressions:
    HighlightedAttributeExpressionsSchema.optional(),
  highlightedRowAttributeExpressions:
    HighlightedAttributeExpressionsSchema.optional(),
  materializedViews: z.array(MaterializedViewConfigurationSchema).optional(),
  metadataMaterializedViews: MetadataMaterializedViewsSchema.optional(),
  orderByExpression: z.string().optional(),
  useTextIndexForImplicitColumn: UseTextIndexSchema.optional(),
});

// Session source form schema
export const SessionSourceSchema = BaseSourceSchema.extend({
  kind: z.literal(SourceKind.Session),

  // Required fields for sessions
  traceSourceId: z
    .string({ message: 'Correlated Trace Source is required' })
    .min(1, 'Correlated Trace Source is required'),

  // Optional fields for sessions
  resourceAttributesExpression: z.string().optional(),
});

// Metric source form schema
export const MetricSourceSchema = BaseSourceSchema.extend({
  kind: z.literal(SourceKind.Metric),
  // override from BaseSourceSchema
  from: z.object({
    databaseName: z.string().min(1, 'Database is required'),
    tableName: z.string(),
  }),

  // Metric tables - at least one should be provided
  metricTables: MetricTableSchema,
  resourceAttributesExpression: z
    .string()
    .min(1, 'Resource Attributes is required'),

  // Optional fields for metrics
  serviceNameExpression: z.string().optional(),
  logSourceId: z.string().optional(),
});

// PromQL source form schema
export const PromqlSourceSchema = BaseSourceSchema.extend({
  kind: z.literal(SourceKind.Promql),
});

// Union of all source form schemas for validation
export const SourceSchema = z.discriminatedUnion('kind', [
  LogSourceSchema,
  TraceSourceSchema,
  SessionSourceSchema,
  MetricSourceSchema,
  PromqlSourceSchema,
]);
export type TSource = z.infer<typeof SourceSchema>;

export const SourceSchemaNoId = z.discriminatedUnion('kind', [
  LogSourceSchema.omit({ id: true }),
  TraceSourceSchema.omit({ id: true }),
  SessionSourceSchema.omit({ id: true }),
  MetricSourceSchema.omit({ id: true }),
  PromqlSourceSchema.omit({ id: true }),
]);
export type TSourceNoId = z.infer<typeof SourceSchemaNoId>;

// Per-kind source types extracted from the Zod discriminated union
export type TLogSource = Extract<TSource, { kind: SourceKind.Log }>;
export type TTraceSource = Extract<TSource, { kind: SourceKind.Trace }>;
export type TSessionSource = Extract<TSource, { kind: SourceKind.Session }>;
export type TMetricSource = Extract<TSource, { kind: SourceKind.Metric }>;
export type TPromqlSource = Extract<TSource, { kind: SourceKind.Promql }>;

// Type guards for narrowing TSource by kind
export function isLogSource(source: TSource): source is TLogSource {
  return source.kind === SourceKind.Log;
}
export function isTraceSource(source: TSource): source is TTraceSource {
  return source.kind === SourceKind.Trace;
}
export function isSessionSource(source: TSource): source is TSessionSource {
  return source.kind === SourceKind.Session;
}
export function isMetricSource(source: TSource): source is TMetricSource {
  return source.kind === SourceKind.Metric;
}
export function isPromqlSource(source: TSource): source is TPromqlSource {
  return source.kind === SourceKind.Promql;
}
export function isSearchableSource(source: TSource): boolean {
  return isLogSource(source) || isTraceSource(source);
}

type SourceLikeForSampleWeight = {
  kind: SourceKind;
  sampleRateExpression?: string | null;
};

/** Trace sample rate expression for chart sampleWeightExpression when set. */
export function getSampleWeightExpression(
  source: SourceLikeForSampleWeight,
): string | undefined {
  return source.kind === SourceKind.Trace && source.sampleRateExpression
    ? source.sampleRateExpression
    : undefined;
}

/** For object spread: { ...pickSampleWeightExpressionProps(source) } */
export function pickSampleWeightExpressionProps(
  source: SourceLikeForSampleWeight,
): { sampleWeightExpression: string } | undefined {
  const w = getSampleWeightExpression(source);
  return w ? { sampleWeightExpression: w } : undefined;
}

export const AssistantLineTableConfigSchema = z.object({
  displayType: z.enum([DisplayType.Line, DisplayType.Table]),
  markdown: z.string().optional(),
  select: z
    .array(
      z.object({
        // TODO: Change percentile to fixed functions
        aggregationFunction: AggregateFunctionSchema.describe(
          'SQL-like function to aggregate the property by',
        ),
        property: z
          .string()
          .describe('Property or column to be aggregated (ex. Duration)'),
        condition: z
          .string()
          .optional()
          .describe(
            "SQL filter condition to filter on ex. `SeverityText = 'error'`",
          ),
      }),
    )
    .describe('Array of data series or columns to chart for the user'),
  groupBy: z
    .string()
    .optional()
    .describe('Group by column or properties for the chart'),
  timeRange: z
    .string()
    .default('Past 1h')
    .describe('Time range of data to query for like "Past 1h", "Past 24h"'),
});

// Base fields common to all three shapes
const AIBaseSchema = z.object({
  from: SelectSQLStatementSchema.shape.from,
  source: z.string(),
  connection: z.string(),
  where: SearchConditionSchema.optional(),
  whereLanguage: SearchConditionLanguageSchema,
  timestampValueExpression: z.string(),
  dateRange: z.tuple([z.string(), z.string()]), // keep as string tuple (ISO recommended)
  name: z.string().optional(),
  markdown: z.string().optional(),
});

// SEARCH
const AISearchQuerySchema = z
  .object({
    displayType: z.literal(DisplayType.Search),
    select: z.string(),
    groupBy: z.string().optional(),
    limit: z
      .object({
        limit: z.number().int().positive(),
      })
      .optional(),
  })
  .merge(
    AIBaseSchema.required({
      where: true,
    }),
  );

// TABLE
const AITableQuerySchema = z
  .object({
    displayType: z.literal(DisplayType.Table),
    // Use your DerivedColumnSchema so aggFn/valueExpression/conditions are validated consistently
    select: z.array(DerivedColumnSchema).min(1),
    groupBy: z.string().optional(),
    granularity: z.union([SQLIntervalSchema, z.literal('auto')]).optional(),
    limit: LimitSchema.optional(),
  })
  .merge(AIBaseSchema);

// LINE
const AILineQuerySchema = z
  .object({
    displayType: z.literal(DisplayType.Line),
    select: z.array(DerivedColumnSchema).min(1),
    groupBy: z.string().optional(),
    granularity: z.union([SQLIntervalSchema, z.literal('auto')]).optional(),
    limit: LimitSchema.optional(),
  })
  .merge(AIBaseSchema);

export type AILineTableResponse =
  | z.infer<typeof AILineQuerySchema>
  | z.infer<typeof AITableQuerySchema>;

// Union that covers all 3 objects
export const AssistantResponseConfig = z.discriminatedUnion('displayType', [
  AISearchQuerySchema,
  AITableQuerySchema,
  AILineQuerySchema,
]);

export type AssistantResponseConfigSchema = z.infer<
  typeof AssistantResponseConfig
>;

// --------------------------
// API RESPONSE SCHEMAS
// --------------------------

// Alerts
export const AlertsPageItemSchema = z.object({
  _id: z.string(),
  interval: AlertIntervalSchema,
  scheduleOffsetMinutes: z.number().optional(),
  scheduleStartAt: z.union([z.string(), z.date()]).nullish(),
  threshold: z.number(),
  thresholdMax: z.number().optional(),
  thresholdType: z.nativeEnum(AlertThresholdType),
  channel: z.object({ type: z.string().optional().nullable() }),
  state: z.nativeEnum(AlertState).optional(),
  source: z.nativeEnum(AlertSource).optional(),
  dashboardId: z.string().optional(),
  savedSearchId: z.string().optional(),
  tileId: z.string().optional(),
  name: z.string().nullish(),
  message: z.string().nullish(),
  note: alertNoteSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
  history: z.array(AlertHistorySchema),
  dashboard: z
    .object({
      _id: z.string(),
      name: z.string(),
      updatedAt: z.string(),
      tags: z.array(z.string()),
      tiles: z.array(
        z.object({
          id: z.string(),
          config: z.object({ name: z.string().optional() }),
        }),
      ),
    })
    .optional(),
  savedSearch: z
    .object({
      _id: z.string(),
      createdAt: z.string(),
      name: z.string(),
      updatedAt: z.string(),
      tags: z.array(z.string()),
    })
    .optional(),
  createdBy: z
    .object({
      email: z.string(),
      name: z.string().optional(),
    })
    .optional(),
  silenced: z
    .object({
      by: z.string(),
      at: z.string(),
      until: z.string(),
    })
    .optional(),
  executionErrors: z.array(AlertErrorSchema).optional(),
});

export type AlertsPageItem = z.infer<typeof AlertsPageItemSchema>;

export const AlertsApiResponseSchema = z.object({
  data: z.array(AlertsPageItemSchema),
});

export type AlertsApiResponse = z.infer<typeof AlertsApiResponseSchema>;

export const AlertApiResponseSchema = z.object({
  data: AlertsPageItemSchema,
});

export type AlertApiResponse = z.infer<typeof AlertApiResponseSchema>;

// Webhooks
export const WebhooksApiResponseSchema = z.object({
  data: z.array(WebhookSchema),
});

export type WebhooksApiResponse = z.infer<typeof WebhooksApiResponseSchema>;

export const WebhookCreateApiResponseSchema = z.object({
  data: WebhookSchema,
});

export type WebhookCreateApiResponse = z.infer<
  typeof WebhookCreateApiResponseSchema
>;

export const WebhookUpdateApiResponseSchema = z.object({
  data: WebhookSchema,
});

export type WebhookUpdateApiResponse = z.infer<
  typeof WebhookUpdateApiResponseSchema
>;

export const WebhookTestApiResponseSchema = z.object({
  message: z.string(),
});

export type WebhookTestApiResponse = z.infer<
  typeof WebhookTestApiResponseSchema
>;

// Team
export const TeamApiResponseSchema = z.object({
  _id: z.string(),
  allowedAuthMethods: z.array(z.literal('password')).optional(),
  apiKey: z.string(),
  name: z.string(),
  createdAt: z.string(),
});

export type TeamApiResponse = z.infer<typeof TeamApiResponseSchema>;

export const TeamMemberSchema = z.object({
  _id: z.string(),
  email: z.string(),
  name: z.string().optional(),
  hasPasswordAuth: z.boolean(),
  isCurrentUser: z.boolean(),
  groupName: z.string().optional(),
});

export type TeamMember = z.infer<typeof TeamMemberSchema>;

export const TeamMembersApiResponseSchema = z.object({
  data: z.array(TeamMemberSchema),
});

export type TeamMembersApiResponse = z.infer<
  typeof TeamMembersApiResponseSchema
>;

export const TeamInvitationSchema = z.object({
  _id: z.string(),
  createdAt: z.string(),
  email: z.string(),
  name: z.string().optional(),
  url: z.string(),
});

export type TeamInvitation = z.infer<typeof TeamInvitationSchema>;

export const TeamInvitationsApiResponseSchema = z.object({
  data: z.array(TeamInvitationSchema),
});

export type TeamInvitationsApiResponse = z.infer<
  typeof TeamInvitationsApiResponseSchema
>;

export const TeamTagsApiResponseSchema = z.object({
  data: z.array(z.string()),
});

export type TeamTagsApiResponse = z.infer<typeof TeamTagsApiResponseSchema>;

export const UpdateClickHouseSettingsApiResponseSchema =
  TeamClickHouseSettingsSchema.partial();

export type UpdateClickHouseSettingsApiResponse = z.infer<
  typeof UpdateClickHouseSettingsApiResponseSchema
>;

export const RotateApiKeyApiResponseSchema = z.object({
  newApiKey: z.string(),
});

export type RotateApiKeyApiResponse = z.infer<
  typeof RotateApiKeyApiResponseSchema
>;

// Installation
export const InstallationApiResponseSchema = z.object({
  isTeamExisting: z.boolean(),
});

export type InstallationApiResponse = z.infer<
  typeof InstallationApiResponseSchema
>;

// Me
export const MeApiResponseSchema = z.object({
  accessKey: z.string(),
  createdAt: z.string(),
  email: z.string(),
  id: z.string(),
  name: z.string(),
  team: TeamSchema.pick({
    id: true,
    name: true,
    allowedAuthMethods: true,
    apiKey: true,
  }).merge(TeamClickHouseSettingsSchema),
  usageStatsEnabled: z.boolean(),
  aiAssistantEnabled: z.boolean(),
});

export type MeApiResponse = z.infer<typeof MeApiResponseSchema>;
