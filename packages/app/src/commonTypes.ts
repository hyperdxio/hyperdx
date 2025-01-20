import { z } from 'zod';

// -------------------------
// ALERTS
// -------------------------

export const AlertSchema = z.object({
  id: z.string().optional(),
  source: z.union([z.literal('saved_search'), z.literal('tile')]).optional(),
  savedSearchId: z.string().optional(),
  groupBy: z.string().optional(),
  interval: z.union([
    z.literal('1m'),
    z.literal('5m'),
    z.literal('15m'),
    z.literal('30m'),
    z.literal('1h'),
    z.literal('6h'),
    z.literal('12h'),
    z.literal('1d'),
  ]),
  threshold: z.number().int().min(1),
  thresholdType: z.union([z.literal('above'), z.literal('below')]),
  channel: z.object({
    type: z.literal('webhook'),
    webhookId: z.string().nonempty("Webhook ID can't be empty"),
  }),
});

// --------------------------
// SAVED SEARCH
// --------------------------

export const SavedSearchSchema = z.object({
  id: z.string(),
  name: z.string(),
  select: z.string(),
  where: z.string(),
  whereLanguage: z.union([z.literal('sql'), z.literal('lucene')]).optional(),
  source: z.string(),
  tags: z.array(z.string()),
  orderBy: z.string().optional(),
  alerts: z.array(AlertSchema).optional(),
});

export type SavedSearch = z.infer<typeof SavedSearchSchema>;

// --------------------------
// DASHBOARDS
// --------------------------

// TODO: Define this
export const SavedChartConfigSchema = z.any();

export const TileSchema = z.object({
  id: z.string(),
  x: z.number(),
  y: z.number(),
  w: z.number(),
  h: z.number(),
  config: SavedChartConfigSchema,
});

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
  tableFilterExpression: z.string().optional(), // Future use for v1 compatibility
  eventAttributesExpression: z.string().optional(),
  resourceAttributesExpression: z.string().optional(),
  defaultTableSelectExpression: z.string().optional(), // Default SELECT for search tables
  // uniqueRowIdExpression: z.string().optional(), // TODO: Allow users to configure how to identify rows uniquely

  // Logs
  severityTextExpression: z.string().optional(),
  traceSourceId: z.string().optional(),

  // Traces & Logs
  traceIdExpression: z.string().optional(),
  spanIdExpression: z.string().optional(),

  // Traces
  durationExpression: z.string().optional(),
  durationPrecision: z.number().min(0).max(9).optional(),
  parentSpanIdExpression: z.string().optional(),
  spanKindExpression: z.string().optional(),
  spanNameExpression: z.string().optional(),
  statusCodeExpression: z.string().optional(),
  statusMessageExpression: z.string().optional(),

  logSourceId: z.string().optional(),
});

export type TSource = z.infer<typeof SourceSchema>;
