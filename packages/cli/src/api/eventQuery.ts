/**
 * Builds ClickHouse SQL for searching events (logs or traces) using
 * renderChartConfig from common-utils.
 */

import type {
  ChSql,
  ColumnMetaType,
} from '@hyperdx/common-utils/dist/clickhouse';
import { chSqlToAliasMap } from '@hyperdx/common-utils/dist/clickhouse';
import { renderChartConfig } from '@hyperdx/common-utils/dist/core/renderChartConfig';
import type { Metadata } from '@hyperdx/common-utils/dist/core/metadata';
import { aliasMapToWithClauses } from '@hyperdx/common-utils/dist/core/utils';
import { DisplayType } from '@hyperdx/common-utils/dist/types';
import type {
  BuilderChartConfigWithDateRange,
  BuilderChartConfigWithOptDateRange,
} from '@hyperdx/common-utils/dist/types';

import type { SourceResponse } from './client';
import { getFirstTimestampValueExpression } from '@/shared/source';
import { buildRowDataSelectList } from '@/shared/rowDataPanel';
import {
  buildTraceSpansConfig,
  buildTraceLogsConfig,
  buildTraceRowDetailConfig,
} from '@/shared/traceConfig';
import { buildColumnMap, getRowWhere } from '@/shared/useRowWhere';

export interface SearchQueryOptions {
  source: SourceResponse;
  /** Override the SELECT clause (user-edited via $EDITOR) */
  selectOverride?: string;
  /** Lucene search string */
  searchQuery?: string;
  /** Date range */
  startTime: Date;
  endTime: Date;
  /** Max rows */
  limit?: number;
  /** Offset for pagination */
  offset?: number;
}

/**
 * Build a default SELECT expression for a trace source when
 * defaultTableSelectExpression is not set.
 */
function buildTraceSelectExpression(source: SourceResponse): string {
  const cols: string[] = [];

  const ts = source.timestampValueExpression ?? 'TimestampTime';
  cols.push(ts);

  if (source.spanNameExpression) cols.push(source.spanNameExpression);
  if (source.serviceNameExpression) cols.push(source.serviceNameExpression);
  if (source.durationExpression) cols.push(source.durationExpression);
  if (source.statusCodeExpression) cols.push(source.statusCodeExpression);
  if (source.traceIdExpression) cols.push(source.traceIdExpression);
  if (source.spanIdExpression) cols.push(source.spanIdExpression);

  return cols.join(', ');
}

/**
 * Build a search query using renderChartConfig — works for both
 * log and trace sources.
 */
export async function buildEventSearchQuery(
  opts: SearchQueryOptions,
  metadata: Metadata,
): Promise<ChSql> {
  const {
    source,
    selectOverride,
    searchQuery = '',
    startTime,
    endTime,
    limit = 100,
    offset,
  } = opts;

  const tsExpr = source.timestampValueExpression ?? 'TimestampTime';
  const firstTsExpr = getFirstTimestampValueExpression(tsExpr) ?? tsExpr;
  const orderBy = source.orderByExpression ?? `${firstTsExpr} DESC`;

  // Use the override if provided, otherwise the source's default
  let selectExpr = selectOverride ?? source.defaultTableSelectExpression ?? '';
  if (!selectExpr && source.kind === 'trace') {
    selectExpr = buildTraceSelectExpression(source);
  }

  const config: BuilderChartConfigWithDateRange = {
    displayType: DisplayType.Search,
    select: selectExpr,
    from: source.from,
    where: searchQuery,
    whereLanguage: searchQuery ? 'lucene' : 'sql',
    connection: source.connection,
    timestampValueExpression: tsExpr,
    implicitColumnExpression: source.implicitColumnExpression,
    orderBy,
    limit: { limit, offset },
    dateRange: [startTime, endTime],
  };

  return renderChartConfig(config, metadata, source.querySettings);
}

// ---- Alias WITH clauses from source select --------------------------

/**
 * Compute WITH clauses from the source's default select expression.
 * When a source defines `SeverityText as level`, searches for `level:error`
 * need `WITH SeverityText AS level` so the alias is available in WHERE.
 */
async function buildAliasWithClauses(
  source: SourceResponse,
  metadata: Metadata,
): Promise<BuilderChartConfigWithDateRange['with']> {
  const selectExpr = source.defaultTableSelectExpression;
  if (!selectExpr) return undefined;

  const tsExpr = source.timestampValueExpression ?? 'TimestampTime';

  // Render a dummy query with the source's select to extract aliases
  const dummyConfig: BuilderChartConfigWithDateRange = {
    displayType: DisplayType.Search,
    select: selectExpr,
    from: source.from,
    where: '',
    connection: source.connection,
    timestampValueExpression: tsExpr,
    implicitColumnExpression: source.implicitColumnExpression,
    limit: { limit: 0 },
    dateRange: [new Date(), new Date()],
  };

  const dummySql = await renderChartConfig(
    dummyConfig,
    metadata,
    source.querySettings,
  );
  const aliasMap = chSqlToAliasMap(dummySql);
  return aliasMapToWithClauses(aliasMap);
}

// ---- Pattern sampling query -----------------------------------------

export interface PatternSampleQueryOptions {
  source: SourceResponse;
  searchQuery?: string;
  startTime: Date;
  endTime: Date;
  /** Number of random rows to sample (default 100_000) */
  sampleLimit?: number;
}

/**
 * Build a query that randomly samples events for pattern mining.
 * Selects the body column and timestamp, ordered by rand().
 */
export async function buildPatternSampleQuery(
  opts: PatternSampleQueryOptions,
  metadata: Metadata,
): Promise<ChSql> {
  const {
    source,
    searchQuery = '',
    startTime,
    endTime,
    sampleLimit = 100_000,
  } = opts;

  const tsExpr = source.timestampValueExpression ?? 'TimestampTime';
  const firstTsExpr = getFirstTimestampValueExpression(tsExpr) ?? tsExpr;

  // Determine the body column
  let bodyExpr: string;
  if (source.kind === 'trace') {
    bodyExpr = source.spanNameExpression ?? 'SpanName';
  } else {
    bodyExpr = source.bodyExpression ?? 'Body';
  }

  const selectExpr = `${bodyExpr}, ${firstTsExpr}`;

  // Compute alias WITH clauses so search aliases (e.g. `level`) resolve in WHERE
  const aliasWith = searchQuery
    ? await buildAliasWithClauses(source, metadata)
    : undefined;

  const config: BuilderChartConfigWithDateRange = {
    displayType: DisplayType.Search,
    select: selectExpr,
    from: source.from,
    where: searchQuery,
    whereLanguage: searchQuery ? 'lucene' : 'sql',
    connection: source.connection,
    timestampValueExpression: tsExpr,
    implicitColumnExpression: source.implicitColumnExpression,
    orderBy: 'rand()',
    limit: { limit: sampleLimit },
    dateRange: [startTime, endTime],
    ...(aliasWith ? { with: aliasWith } : {}),
  };

  return renderChartConfig(config, metadata, source.querySettings);
}

// ---- Total count query ----------------------------------------------

export interface TotalCountQueryOptions {
  source: SourceResponse;
  searchQuery?: string;
  startTime: Date;
  endTime: Date;
}

/**
 * Build a query to get the total count of events matching the search.
 */
export async function buildTotalCountQuery(
  opts: TotalCountQueryOptions,
  metadata: Metadata,
): Promise<ChSql> {
  const { source, searchQuery = '', startTime, endTime } = opts;

  const tsExpr = source.timestampValueExpression ?? 'TimestampTime';

  // Compute alias WITH clauses so search aliases (e.g. `level`) resolve in WHERE
  const aliasWith = searchQuery
    ? await buildAliasWithClauses(source, metadata)
    : undefined;

  const config: BuilderChartConfigWithDateRange = {
    displayType: DisplayType.Table,
    select: 'count() as total',
    from: source.from,
    where: searchQuery,
    whereLanguage: searchQuery ? 'lucene' : 'sql',
    connection: source.connection,
    timestampValueExpression: tsExpr,
    implicitColumnExpression: source.implicitColumnExpression,
    limit: { limit: 1 },
    dateRange: [startTime, endTime],
    ...(aliasWith ? { with: aliasWith } : {}),
  };

  return renderChartConfig(config, metadata, source.querySettings);
}

// ---- Full row fetch (SELECT *) -------------------------------------

// ---- Trace waterfall queries ----------------------------------------

export interface TraceSpansQueryOptions {
  source: SourceResponse;
  traceId: string;
  dateRange?: [Date, Date];
}

/**
 * Build a query to fetch all spans for a given traceId using
 * renderChartConfig. Enables time partition pruning when dateRange
 * is provided and materialized field optimisation.
 */
export async function buildTraceSpansQuery(
  opts: TraceSpansQueryOptions,
  metadata: Metadata,
): Promise<ChSql> {
  const config = buildTraceSpansConfig(opts);
  return renderChartConfig(config, metadata, opts.source.querySettings);
}

/**
 * Build a query to fetch correlated log events for a given traceId
 * using renderChartConfig.
 */
export async function buildTraceLogsQuery(
  opts: TraceSpansQueryOptions,
  metadata: Metadata,
): Promise<ChSql> {
  const config = buildTraceLogsConfig(opts);
  return renderChartConfig(config, metadata, opts.source.querySettings);
}

/**
 * Build a query to fetch a single span/log row (SELECT *) from the
 * trace waterfall detail panel. Omits dateRange so ClickHouse uses
 * the WHERE clause directly.
 */
export async function buildTraceRowDetailQuery(
  opts: {
    source: SourceResponse;
    traceId: string;
    spanId?: string;
    timestamp: string;
  },
  metadata: Metadata,
): Promise<ChSql> {
  const config = buildTraceRowDetailConfig(opts);
  return renderChartConfig(config, metadata, opts.source.querySettings);
}

export interface FullRowQueryOptions {
  source: SourceResponse;
  /** The partial row data from the table (used to build the WHERE clause) */
  row: Record<string, unknown>;
}

/**
 * Build a full row query using renderChartConfig, matching the web
 * frontend's useRowData in DBRowDataPanel.tsx.
 *
 * @source packages/app/src/components/DBRowDataPanel.tsx (useRowData)
 * @source packages/app/src/hooks/useRowWhere.tsx (processRowToWhereClause)
 *
 * Uses chSqlToAliasMap from the table query's rendered SQL + column
 * metadata to build a proper WHERE clause with type-aware matching,
 * then queries:
 *   SELECT *, <__hdx_* aliases>
 *   FROM source.from
 *   WHERE <processRowToWhereClause>
 *   WITH <aliasWith>
 *   LIMIT 1
 */
export interface FullRowQueryResult {
  chSql: ChSql;
  /** The SQL WHERE clause that uniquely identifies the row (for browser URL) */
  rowWhere: string;
}

export async function buildFullRowQuery(
  opts: FullRowQueryOptions & {
    /** The rendered ChSql from the table query (for alias resolution) */
    tableChSql: ChSql;
    /** Column metadata from the table query response */
    tableMeta: ColumnMetaType[];
    metadata: Metadata;
  },
): Promise<FullRowQueryResult> {
  const { source, row, tableChSql, tableMeta, metadata } = opts;

  // Parse the rendered table SQL to get alias → expression mapping
  const aliasMap = chSqlToAliasMap(tableChSql);

  // Build column map using both meta (types) and aliasMap (expressions)
  const columnMap = buildColumnMap(tableMeta, aliasMap);

  // Build WHERE using the web frontend's processRowToWhereClause
  const rowWhereResult = getRowWhere(
    row as Record<string, unknown>,
    columnMap,
    aliasMap,
  );

  const selectList = buildRowDataSelectList(source);

  // Omit dateRange and timestampValueExpression — the WHERE clause
  // already uniquely identifies the row so ClickHouse can use the
  // filter directly without scanning time partitions.
  // This matches the web frontend's useRowData in DBRowDataPanel.tsx.
  const config: BuilderChartConfigWithOptDateRange = {
    connection: source.connection,
    from: source.from,
    select: selectList,
    where: rowWhereResult.where,
    limit: { limit: 1 },
    displayType: DisplayType.Table,
    ...(rowWhereResult.aliasWith.length > 0
      ? { with: rowWhereResult.aliasWith }
      : {}),
  };

  const chSql = await renderChartConfig(config, metadata, source.querySettings);
  return { chSql, rowWhere: rowWhereResult.where };
}
