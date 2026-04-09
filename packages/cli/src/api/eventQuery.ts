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
import { DisplayType } from '@hyperdx/common-utils/dist/types';
import type { BuilderChartConfigWithDateRange } from '@hyperdx/common-utils/dist/types';
import SqlString from 'sqlstring';

import type { SourceResponse } from './client';
import {
  getFirstTimestampValueExpression,
  getDisplayedTimestampValueExpression,
} from '@/shared/source';
import { buildRowDataSelectList } from '@/shared/rowDataPanel';
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

// ---- Full row fetch (SELECT *) -------------------------------------

// ---- Trace waterfall query (all spans for a traceId) ----------------

export interface TraceSpansQueryOptions {
  source: SourceResponse;
  traceId: string;
}

/**
 * Build a raw SQL query to fetch all spans for a given traceId.
 * Returns columns needed for the waterfall chart.
 */
export function buildTraceSpansSql(opts: TraceSpansQueryOptions): {
  sql: string;
  connectionId: string;
} {
  const { source, traceId } = opts;

  const db = source.from.databaseName;
  const table = source.from.tableName;
  const traceIdExpr = source.traceIdExpression ?? 'TraceId';
  const spanIdExpr = source.spanIdExpression ?? 'SpanId';
  const parentSpanIdExpr = source.parentSpanIdExpression ?? 'ParentSpanId';
  const spanNameExpr = source.spanNameExpression ?? 'SpanName';
  const serviceNameExpr = source.serviceNameExpression ?? 'ServiceName';
  const durationExpr = source.durationExpression ?? 'Duration';
  const statusCodeExpr = source.statusCodeExpression ?? 'StatusCode';

  const tsExpr = getDisplayedTimestampValueExpression(source);

  const cols = [
    `${tsExpr} AS Timestamp`,
    `${traceIdExpr} AS TraceId`,
    `${spanIdExpr} AS SpanId`,
    `${parentSpanIdExpr} AS ParentSpanId`,
    `${spanNameExpr} AS SpanName`,
    `${serviceNameExpr} AS ServiceName`,
    `${durationExpr} AS Duration`,
    `${statusCodeExpr} AS StatusCode`,
  ];

  const escapedTraceId = SqlString.escape(traceId);
  const sql = `SELECT ${cols.join(', ')} FROM ${db}.${table} WHERE ${traceIdExpr} = ${escapedTraceId} ORDER BY ${tsExpr} ASC LIMIT 10000`;

  return {
    sql,
    connectionId: source.connection,
  };
}

/**
 * Build a raw SQL query to fetch correlated log events for a given traceId.
 * Returns columns matching the SpanRow shape used by the waterfall chart.
 * Logs are linked to spans via their SpanId.
 */
export function buildTraceLogsSql(opts: TraceSpansQueryOptions): {
  sql: string;
  connectionId: string;
} {
  const { source, traceId } = opts;

  const db = source.from.databaseName;
  const table = source.from.tableName;
  const traceIdExpr = source.traceIdExpression ?? 'TraceId';
  const spanIdExpr = source.spanIdExpression ?? 'SpanId';
  const bodyExpr = source.bodyExpression ?? 'Body';
  const serviceNameExpr = source.serviceNameExpression ?? 'ServiceName';
  const sevExpr = source.severityTextExpression ?? 'SeverityText';

  const tsExpr = getDisplayedTimestampValueExpression(source);

  const cols = [
    `${tsExpr} AS Timestamp`,
    `${traceIdExpr} AS TraceId`,
    `${spanIdExpr} AS SpanId`,
    `'' AS ParentSpanId`,
    `${bodyExpr} AS SpanName`,
    `${serviceNameExpr} AS ServiceName`,
    `0 AS Duration`,
    `${sevExpr} AS StatusCode`,
  ];

  const escapedTraceId = SqlString.escape(traceId);
  const sql = `SELECT ${cols.join(', ')} FROM ${db}.${table} WHERE ${traceIdExpr} = ${escapedTraceId} ORDER BY ${tsExpr} ASC LIMIT 10000`;

  return {
    sql,
    connectionId: source.connection,
  };
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
export async function buildFullRowQuery(
  opts: FullRowQueryOptions & {
    /** The rendered ChSql from the table query (for alias resolution) */
    tableChSql: ChSql;
    /** Column metadata from the table query response */
    tableMeta: ColumnMetaType[];
    metadata: Metadata;
  },
): Promise<ChSql> {
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

  // Use a very wide date range — the WHERE clause already uniquely
  // identifies the row, so the time range is just a safety net
  const now = new Date();
  const yearAgo = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);

  const config: BuilderChartConfigWithDateRange = {
    connection: source.connection,
    from: source.from,
    timestampValueExpression:
      source.timestampValueExpression ?? 'TimestampTime',
    dateRange: [yearAgo, now],
    select: selectList,
    where: rowWhereResult.where,
    limit: { limit: 1 },
    displayType: DisplayType.Table,
    ...(rowWhereResult.aliasWith.length > 0
      ? { with: rowWhereResult.aliasWith }
      : {}),
  };

  return renderChartConfig(config, metadata, source.querySettings);
}
