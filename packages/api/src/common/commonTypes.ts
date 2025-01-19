import { z } from 'zod';

import { DisplayType } from '@/common/DisplayType';

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

export const SqlAstFilterSchema = z.object({
  type: z.literal('sql_ast'),
  operator: z.enum(['=', '<', '>', '!=', '<=', '>=']),
  left: z.string(),
  right: z.string(),
});

export const FilterSchema = z.union([
  z.object({
    type: z.enum(['lucene', 'sql']),
    condition: z.string(),
  }),
  SqlAstFilterSchema,
]);

export const _ChartConfigSchema = z.object({
  displayType: z.nativeEnum(DisplayType),
  numberFormat: NumberFormatSchema.optional(),
  timestampValueExpression: z.string(),
  implicitColumnExpression: z.string().optional(),
  granularity: z.string().optional(),
  markdown: z.string().optional(),
  filtersLogicalOperator: z.enum(['AND', 'OR']).optional(),
  filters: z.array(FilterSchema).optional(),
  connection: z.string(),
  fillNulls: z.number().optional(),
  selectGroupBy: z.boolean().optional(),
});

export const ChartConfigSchema = z.intersection(
  _ChartConfigSchema,
  SelectSQLStatementSchema,
);

export const SavedChartConfigSchema = z.intersection(
  z.intersection(
    z.object({
      name: z.string(),
      source: z.string(),
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
export const SourceSchema = z.object({
  from: z.object({
    databaseName: z.string(),
    tableName: z.string(),
  }),
  timestampValueExpression: z.string(),
  connection: z.string(),

  // Common
  kind: z.enum(['log', 'trace']),
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
