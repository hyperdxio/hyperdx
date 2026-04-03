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

// --------------------------
//  SQL TYPES
// --------------------------
// TODO: infer types from here and replaces all types in sqlTypes.ts
export const SQLIntervalSchema = z
  .string()
  .regex(/^\d+ (second|minute|hour|day)$/);
export const SearchConditionSchema = z.string();
export const SearchConditionLanguageSchema = z
  .enum(['sql', 'lucene'])
  .optional();
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

// Base webhook schema (matches backend IWebhook but with JSON-serialized types)
// When making changes here, consider if they need to be made to the external API schema as well (packages/api/src/utils/zod.ts).
export const WebhookSchema = z.object({
  _id: z.string(),
  createdAt: z.string(),
  name: z.string(),
  service: z.nativeEnum(WebhookService),
  updatedAt: z.string(),
  url: z.string().optional(),
  description: z.string().optional(),
  queryParams: z.record(z.string(), z.string()).optional(),
  headers: z.record(z.string(), z.string()).optional(),
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
}

export enum AlertState {
  ALERT = 'ALERT',
  DISABLED = 'DISABLED',
  INSUFFICIENT_DATA = 'INSUFFICIENT_DATA',
  OK = 'OK',
}

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
  channel: zAlertChannel,
  state: z.nativeEnum(AlertState).optional(),
  name: z.string().min(1).max(512).nullish(),
  message: z.string().min(1).max(4096).nullish(),
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
);

export const ChartAlertBaseSchema = AlertBaseObjectSchema.extend({
  threshold: z.number(),
});

const ChartAlertBaseValidatedSchema = ChartAlertBaseSchema.superRefine(
  validateAlertScheduleOffsetMinutes,
);

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

// --------------------------
// DASHBOARDS
// --------------------------
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

// When making changes here, consider if they need to be made to the external API
// schema as well (packages/api/src/utils/zod.ts).

/**
 * Schema describing display settings which are shared between Raw SQL
 * chart configs and Structured ChartBuilder chart configs
 **/
const SharedChartDisplaySettingsSchema = z.object({
  displayType: z.nativeEnum(DisplayType).optional(),
  numberFormat: NumberFormatSchema.optional(),
  granularity: z.union([SQLIntervalSchema, z.literal('auto')]).optional(),
  compareToPreviousPeriod: z.boolean().optional(),
  fillNulls: z.union([z.number(), z.literal(false)]).optional(),
  alignDateRangeToGranularity: z.boolean().optional(),
});

export const _ChartConfigSchema = SharedChartDisplaySettingsSchema.extend({
  timestampValueExpression: z.string(),
  implicitColumnExpression: z.string().optional(),
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
const RawSqlBaseChartConfigSchema = SharedChartDisplaySettingsSchema.extend({
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
  metricTables: MetricTableSchema.optional(),
});

export type RawSqlChartConfig = z.infer<typeof RawSqlChartConfigSchema>;

export const ChartConfigSchema = z.union([
  BuilderChartConfigSchema,
  RawSqlChartConfigSchema,
]);

export type ChartConfig = z.infer<typeof ChartConfigSchema>;

export type DateRange = {
  dateRange: [Date, Date];
  dateRangeStartInclusive?: boolean; // default true
  dateRangeEndInclusive?: boolean; // default true
};

export type ChartConfigWithDateRange = ChartConfig & DateRange;
export type BuilderChartConfigWithDateRange = BuilderChartConfig & DateRange;
export type RawSqlConfigWithDateRange = RawSqlChartConfig & DateRange;

export type BuilderChartConfigWithOptTimestamp = Omit<
  BuilderChartConfigWithDateRange,
  'timestampValueExpression'
> & {
  timestampValueExpression?: string;
};

export type ChartConfigWithOptTimestamp =
  | BuilderChartConfigWithOptTimestamp
  | RawSqlConfigWithDateRange;

// For non-time-based searches (ex. grab 1 row)
export type BuilderChartConfigWithOptDateRange = Omit<
  BuilderChartConfig,
  'timestampValueExpression'
> & {
  timestampValueExpression?: string;
} & Partial<DateRange>;

export type ChartConfigWithOptDateRange =
  | BuilderChartConfigWithOptDateRange
  | (RawSqlChartConfig & Partial<DateRange>);

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

const RawSqlSavedChartConfigSchema = RawSqlBaseChartConfigSchema.extend({
  name: z.string().optional(),
});

export const SavedChartConfigSchema = z.union([
  BuilderSavedChartConfigSchema,
  RawSqlSavedChartConfigSchema,
]);

export type RawSqlSavedChartConfig = z.infer<
  typeof RawSqlSavedChartConfigSchema
>;

export type SavedChartConfig = z.infer<typeof SavedChartConfigSchema>;

export const TileSchema = z.object({
  id: z.string(),
  x: z.number(),
  y: z.number(),
  w: z.number(),
  h: z.number(),
  config: SavedChartConfigSchema,
  containerId: z.string().optional(),
});

export const TileTemplateSchema = TileSchema.extend({
  config: z.union([
    BuilderSavedChartConfigWithoutAlertSchema,
    RawSqlSavedChartConfigSchema,
  ]),
});

export type Tile = z.infer<typeof TileSchema>;

export const DashboardContainerSchema = z.object({
  id: z.string().min(1),
  type: z.enum(['section']),
  title: z.string().min(1),
  collapsed: z.boolean(),
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
  whereLanguage: SearchConditionLanguageSchema,
});

export type DashboardFilter = z.infer<typeof DashboardFilterSchema>;

export enum PresetDashboard {
  Services = 'services',
}

export const PresetDashboardFilterSchema = DashboardFilterSchema.extend({
  presetDashboard: z.nativeEnum(PresetDashboard),
});

export type PresetDashboardFilter = z.infer<typeof PresetDashboardFilterSchema>;

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
    .refine(
      containers => {
        const ids = containers.map(c => c.id);
        return new Set(ids).size === ids.length;
      },
      { message: 'Container IDs must be unique' },
    )
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
  tiles: z.array(TileTemplateSchema),
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
  kind: z.nativeEnum(SourceKind),
  connection: z.string().min(1, 'Server Connection is required'),
  from: z.object({
    databaseName: z.string().min(1, 'Database is required'),
    tableName: z.string().min(1, 'Table is required'),
  }),
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
  uniqueRowIdExpression: z.string().optional(),
  tableFilterExpression: z.string().optional(),
  highlightedTraceAttributeExpressions:
    HighlightedAttributeExpressionsSchema.optional(),
  highlightedRowAttributeExpressions:
    HighlightedAttributeExpressionsSchema.optional(),
  materializedViews: z.array(MaterializedViewConfigurationSchema).optional(),
  orderByExpression: z.string().optional(),
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
  orderByExpression: z.string().optional(),
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

// Union of all source form schemas for validation
export const SourceSchema = z.discriminatedUnion('kind', [
  LogSourceSchema,
  TraceSourceSchema,
  SessionSourceSchema,
  MetricSourceSchema,
]);
export type TSource = z.infer<typeof SourceSchema>;

export const SourceSchemaNoId = z.discriminatedUnion('kind', [
  LogSourceSchema.omit({ id: true }),
  TraceSourceSchema.omit({ id: true }),
  SessionSourceSchema.omit({ id: true }),
  MetricSourceSchema.omit({ id: true }),
]);
export type TSourceNoId = z.infer<typeof SourceSchemaNoId>;

// Per-kind source types extracted from the Zod discriminated union
export type TLogSource = Extract<TSource, { kind: SourceKind.Log }>;
export type TTraceSource = Extract<TSource, { kind: SourceKind.Trace }>;
export type TSessionSource = Extract<TSource, { kind: SourceKind.Session }>;
export type TMetricSource = Extract<TSource, { kind: SourceKind.Metric }>;

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
  thresholdType: z.nativeEnum(AlertThresholdType),
  channel: z.object({ type: z.string().optional().nullable() }),
  state: z.nativeEnum(AlertState).optional(),
  source: z.nativeEnum(AlertSource).optional(),
  dashboardId: z.string().optional(),
  savedSearchId: z.string().optional(),
  tileId: z.string().optional(),
  name: z.string().nullish(),
  message: z.string().nullish(),
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
});

export type AlertsPageItem = z.infer<typeof AlertsPageItemSchema>;

export const AlertsApiResponseSchema = z.object({
  data: z.array(AlertsPageItemSchema),
});

export type AlertsApiResponse = z.infer<typeof AlertsApiResponseSchema>;

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
