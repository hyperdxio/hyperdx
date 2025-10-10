import { z } from 'zod';

// Basic Enums
export enum MetricsDataType {
  Gauge = 'gauge',
  Histogram = 'histogram',
  Sum = 'sum',
  Summary = 'summary',
  ExponentialHistogram = 'exponential histogram',
}

// --------------------------
//  UI
// --------------------------
export enum DisplayType {
  Line = 'line',
  StackedBar = 'stacked_bar',
  Table = 'table',
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
export const AggregateFunctionWithCombinatorsSchema = z
  .string()
  .regex(/^(\w+)If(State|Merge)$/);

export const RootValueExpressionSchema = z
  .object({
    aggFn: z.union([
      AggregateFunctionSchema,
      AggregateFunctionWithCombinatorsSchema,
    ]),
    aggCondition: SearchConditionSchema,
    aggConditionLanguage: SearchConditionLanguageSchema,
    valueExpression: z.string(),
    isDelta: z.boolean().optional(),
  })
  .or(
    z.object({
      aggFn: z.literal('quantile'),
      level: z.number(),
      aggCondition: SearchConditionSchema,
      aggConditionLanguage: SearchConditionLanguageSchema,
      valueExpression: z.string(),
      isDelta: z.boolean().optional(),
    }),
  )
  .or(
    z.object({
      aggFn: z.string().optional(),
      aggCondition: z.string().optional(),
      aggConditionLanguage: SearchConditionLanguageSchema,
      valueExpression: z.string(),
      metricType: z.nativeEnum(MetricsDataType).optional(),
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
}

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

export const AlertBaseSchema = z.object({
  id: z.string().optional(),
  interval: AlertIntervalSchema,
  threshold: z.number().int().min(1),
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

export const ChartAlertBaseSchema = AlertBaseSchema.extend({
  threshold: z.number().positive(),
});

export const AlertSchema = z.union([
  z.intersection(AlertBaseSchema, zSavedSearchAlert),
  z.intersection(ChartAlertBaseSchema, zTileAlert),
]);

export type Alert = z.infer<typeof AlertSchema>;

export type AlertHistory = {
  counts: number;
  createdAt: string;
  lastValues: { startTime: string; count: number }[];
  state: AlertState;
};

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
  alerts: z.array(AlertSchema).optional(),
});

export type SavedSearch = z.infer<typeof SavedSearchSchema>;

// --------------------------
// DASHBOARDS
// --------------------------
export const NumberFormatSchema = z.object({
  output: z.enum(['currency', 'percent', 'byte', 'time', 'number']),
  mantissa: z.number().optional(),
  thousandSeparated: z.boolean().optional(),
  average: z.boolean().optional(),
  decimalBytes: z.boolean().optional(),
  factor: z.number().optional(),
  currencySymbol: z.string().optional(),
  unit: z.string().optional(),
});

export type NumberFormat = z.infer<typeof NumberFormatSchema>;

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

export const _ChartConfigSchema = z.object({
  displayType: z.nativeEnum(DisplayType).optional(),
  numberFormat: NumberFormatSchema.optional(),
  timestampValueExpression: z.string(),
  implicitColumnExpression: z.string().optional(),
  granularity: z.union([SQLIntervalSchema, z.literal('auto')]).optional(),
  markdown: z.string().optional(),
  filtersLogicalOperator: z.enum(['AND', 'OR']).optional(),
  filters: z.array(FilterSchema).optional(),
  connection: z.string(),
  fillNulls: z.union([z.number(), z.literal(false)]).optional(),
  selectGroupBy: z.boolean().optional(),
  metricTables: MetricTableSchema.optional(),
  seriesReturnType: z.enum(['ratio', 'column']).optional(),
});

// This is a ChartConfig type without the `with` CTE clause included.
// It needs to be a separate, named schema to avoid use ot z.lazy(...),
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
export const ChartConfigSchema = z.intersection(
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

export type ChartConfig = z.infer<typeof ChartConfigSchema>;

export type DateRange = {
  dateRange: [Date, Date];
  dateRangeStartInclusive?: boolean; // default true
  dateRangeEndInclusive?: boolean; // default true
};

export type ChartConfigWithDateRange = ChartConfig & DateRange;

export type ChartConfigWithOptTimestamp = Omit<
  ChartConfigWithDateRange,
  'timestampValueExpression'
> & {
  timestampValueExpression?: string;
};
// For non-time-based searches (ex. grab 1 row)
export type ChartConfigWithOptDateRange = Omit<
  ChartConfig,
  'timestampValueExpression'
> & {
  timestampValueExpression?: string;
} & Partial<DateRange>;

export const SavedChartConfigSchema = z
  .object({
    name: z.string(),
    source: z.string(),
    alert: z.union([
      AlertBaseSchema.optional(),
      ChartAlertBaseSchema.optional(),
    ]),
  })
  .extend(
    _ChartConfigSchema.omit({
      connection: true,
      timestampValueExpression: true,
    }).shape,
  )
  .extend(
    SelectSQLStatementSchema.omit({
      from: true,
    }).shape,
  );

export type SavedChartConfig = z.infer<typeof SavedChartConfigSchema>;

export const TileSchema = z.object({
  id: z.string(),
  x: z.number(),
  y: z.number(),
  w: z.number(),
  h: z.number(),
  config: SavedChartConfigSchema,
});
export const TileTemplateSchema = TileSchema.extend({
  config: TileSchema.shape.config.omit({ alert: true }),
});

export type Tile = z.infer<typeof TileSchema>;

export const DashboardFilterType = z.enum(['QUERY_EXPRESSION']);

export const DashboardFilterSchema = z.object({
  id: z.string(),
  type: DashboardFilterType,
  name: z.string().min(1),
  expression: z.string().min(1),
  source: z.string().min(1),
  sourceMetricType: z.nativeEnum(MetricsDataType).optional(),
});

export type DashboardFilter = z.infer<typeof DashboardFilterSchema>;

export const DashboardSchema = z.object({
  id: z.string(),
  name: z.string().min(1),
  tiles: z.array(TileSchema),
  tags: z.array(z.string()),
  filters: z.array(DashboardFilterSchema).optional(),
});
export const DashboardWithoutIdSchema = DashboardSchema.omit({ id: true });
export type DashboardWithoutId = z.infer<typeof DashboardWithoutIdSchema>;

export const DashboardTemplateSchema = DashboardWithoutIdSchema.omit({
  tags: true,
}).extend({
  version: z.string().min(1),
  tiles: z.array(TileTemplateSchema),
  filters: z.array(DashboardFilterSchema).optional(),
});

export const ConnectionSchema = z.object({
  id: z.string(),
  name: z.string(),
  host: z.string(),
  username: z.string(),
  password: z.string().optional(),
});

export type Connection = z.infer<typeof ConnectionSchema>;

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

// Base schema with fields common to all source types
const SourceBaseSchema = z.object({
  id: z.string(),
  name: z.string().min(1, 'Name is required'),
  kind: z.nativeEnum(SourceKind),
  connection: z.string().min(1, 'Server Connection is required'),
  from: z.object({
    databaseName: z.string().min(1, 'Database is required'),
    tableName: z.string().min(1, 'Table is required'),
  }),
  timestampValueExpression: z.string(), // overridden if required in the rest of schemas
});

const RequiredTimestampColumnSchema = z
  .string()
  .min(1, 'Timestamp Column is required');

// Log source form schema
export const LogSourceSchema = SourceBaseSchema.extend({
  kind: z.literal(SourceKind.Log),
  timestampValueExpression: RequiredTimestampColumnSchema,
  defaultTableSelectExpression: z.string({
    message: 'Default Table Select Expression is required',
  }),

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
});

// Trace source form schema
export const TraceSourceSchema = SourceBaseSchema.extend({
  kind: z.literal(SourceKind.Trace),
  defaultTableSelectExpression: z.string().optional(),
  timestampValueExpression: RequiredTimestampColumnSchema,

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
});

// Session source form schema
export const SessionSourceSchema = SourceBaseSchema.extend({
  kind: z.literal(SourceKind.Session),
  timestampValueExpression: z.string().optional(),

  // Required fields for sessions
  traceSourceId: z
    .string({ message: 'Correlated Trace Source is required' })
    .min(1, 'Correlated Trace Source is required'),
});

// Metric source form schema
export const MetricSourceSchema = SourceBaseSchema.extend({
  kind: z.literal(SourceKind.Metric),
  // override from SourceBaseSchema
  from: z.object({
    databaseName: z.string().min(1, 'Database is required'),
    tableName: z.string(),
  }),

  // Metric tables - at least one should be provided
  metricTables: MetricTableSchema,
  timestampValueExpression: RequiredTimestampColumnSchema,
  resourceAttributesExpression: z
    .string()
    .min(1, 'Resource Attributes is required'),

  // Optional fields for metrics
  logSourceId: z.string().optional(),
});

// Union of all source form schemas for validation
export const SourceSchema = z.discriminatedUnion('kind', [
  LogSourceSchema,
  TraceSourceSchema,
  SessionSourceSchema,
  MetricSourceSchema,
]);
export const SourceSchemaNoId = z.discriminatedUnion('kind', [
  LogSourceSchema.omit({ id: true }),
  TraceSourceSchema.omit({ id: true }),
  SessionSourceSchema.omit({ id: true }),
  MetricSourceSchema.omit({ id: true }),
]);
export type TSource = z.infer<typeof SourceSchema>;
export type TSourceNoId = z.infer<typeof SourceSchemaNoId>;
export type TLogSource = Extract<TSource, { kind: SourceKind.Log }>;
export type TTraceSource = Extract<TSource, { kind: SourceKind.Trace }>;
export type TMetricSource = Extract<TSource, { kind: SourceKind.Metric }>;
export type TSessionSource = Extract<TSource, { kind: SourceKind.Session }>;
