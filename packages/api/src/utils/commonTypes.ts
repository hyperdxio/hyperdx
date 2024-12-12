import { z } from 'zod';

// --------------------------
// SAVED SEARCH
// --------------------------

export const SavedSearchSchema = z.object({
  id: z.string(),
  name: z.string(),
  select: z.string(),
  where: z.string(),
  whereLanguage: z.string().optional(),
  source: z.string(),
  tags: z.array(z.string()),
  orderBy: z.string().optional(),
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
