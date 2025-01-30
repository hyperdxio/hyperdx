import { z } from 'zod';

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
  'max',
  'min',
  'quantile',
  'sum',
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
  })
  .or(
    z.object({
      aggFn: z.literal('quantile'),
      level: z.number(),
      aggCondition: SearchConditionSchema,
      aggConditionLanguage: SearchConditionLanguageSchema,
      valueExpression: z.string(),
    }),
  )
  .or(
    z.object({
      aggFn: z.string().optional(),
      aggCondition: z.string().optional(),
      aggConditionLanguage: SearchConditionLanguageSchema,
      valueExpression: z.string(),
    }),
  );
export const DerivedColumnSchema = z.intersection(
  RootValueExpressionSchema,
  z.object({
    alias: z.string().optional(),
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

export const AlertSchema = AlertBaseSchema.and(
  zSavedSearchAlert.or(zTileAlert),
);

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
});

export const ChartConfigSchema = z.intersection(
  _ChartConfigSchema,
  SelectSQLStatementSchema,
);

export type ChartConfig = z.infer<typeof ChartConfigSchema>;

export type DateRange = {
  dateRange: [Date, Date];
  dateRangeStartInclusive?: boolean; // default true
};

export type ChartConfigWithDateRange = ChartConfig & DateRange;
// For non-time-based searches (ex. grab 1 row)
export type ChartConfigWithOptDateRange = Omit<
  ChartConfig,
  'timestampValueExpression'
> & {
  timestampValueExpression?: string;
} & Partial<DateRange>;

export const SavedChartConfigSchema = z.intersection(
  z.intersection(
    z.object({
      name: z.string(),
      source: z.string(),
      alert: AlertBaseSchema.optional(),
    }),
    _ChartConfigSchema.omit({
      connection: true,
      timestampValueExpression: true,
    }),
  ),
  SelectSQLStatementSchema.omit({
    from: true,
  }),
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

export type Tile = z.infer<typeof TileSchema>;

export const DashboardSchema = z.object({
  id: z.string(),
  name: z.string(),
  tiles: z.array(TileSchema),
  tags: z.array(z.string()),
});

export const DashboardWithoutIdSchema = DashboardSchema.omit({ id: true });

export const ConnectionSchema = z.object({
  id: z.string(),
  name: z.string(),
  host: z.string(),
  username: z.string(),
  password: z.string().optional(),
});

// --------------------------
// TABLE SOURCES
// --------------------------
export enum SourceKind {
  Log = 'log',
  Trace = 'trace',
  Session = 'session',
}
export const SourceSchema = z.object({
  from: z.object({
    databaseName: z.string(),
    tableName: z.string(),
  }),
  timestampValueExpression: z.string(),
  connection: z.string(),

  // Common
  kind: z.nativeEnum(SourceKind),
  id: z.string(),
  name: z.string(),
  displayedTimestampValueExpression: z.string().optional(),
  implicitColumnExpression: z.string().optional(),
  serviceNameExpression: z.string().optional(),
  bodyExpression: z.string().optional(),
  tableFilterExpression: z.string().optional(),
  eventAttributesExpression: z.string().optional(),
  resourceAttributesExpression: z.string().optional(),
  defaultTableSelectExpression: z.string().optional(),

  // Logs
  uniqueRowIdExpression: z.string().optional(),
  severityTextExpression: z.string().optional(),
  traceSourceId: z.string().optional(),

  // Traces & Logs
  traceIdExpression: z.string().optional(),
  spanIdExpression: z.string().optional(),

  // Traces
  durationExpression: z.string().optional(),
  durationPrecision: z.number().min(0).max(9).optional(),
  parentSpanIdExpression: z.string().optional(),
  spanNameExpression: z.string().optional(),

  spanKindExpression: z.string().optional(),
  statusCodeExpression: z.string().optional(),
  statusMessageExpression: z.string().optional(),
  logSourceId: z.string().optional(),
});

export type TSource = z.infer<typeof SourceSchema>;
