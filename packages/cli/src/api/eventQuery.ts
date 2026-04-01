/**
 * Builds ClickHouse SQL for searching events (logs or traces) using
 * renderChartConfig from common-utils.
 */

import type { ChSql } from '@hyperdx/common-utils/dist/clickhouse';
import { renderChartConfig } from '@hyperdx/common-utils/dist/core/renderChartConfig';
import type { Metadata } from '@hyperdx/common-utils/dist/core/metadata';
import { getFirstTimestampValueExpression } from '@hyperdx/common-utils/dist/core/utils';
import { DisplayType } from '@hyperdx/common-utils/dist/types';
import type { BuilderChartConfigWithDateRange } from '@hyperdx/common-utils/dist/types';
import SqlString from 'sqlstring';

import type { SourceResponse } from './client';

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

/**
 * Build a WHERE clause from all the row's column values to uniquely
 * identify it for a SELECT * point lookup.
 *
 * Uses every scalar (string/number) column in the row — skips objects
 * (Maps, Arrays) since they can't be compared with simple = operators.
 */
function buildRowWhereClause(
  row: Record<string, unknown>,
  source: SourceResponse,
): string {
  const clauses: string[] = [];

  for (const [col, value] of Object.entries(row)) {
    if (value == null) continue;

    // Skip complex types (Maps, Arrays, Objects) — can't do simple = comparison
    if (typeof value === 'object') continue;

    const strVal = String(value);
    // Skip empty strings
    if (strVal === '') continue;
    // Skip very long values to avoid huge WHERE clauses
    if (strVal.length > 512) continue;

    // Detect timestamp columns — use parseDateTime64BestEffort for matching
    if (
      col === 'Timestamp' ||
      col === (source.timestampValueExpression ?? 'TimestampTime')
    ) {
      clauses.push(
        SqlString.format('? = parseDateTime64BestEffort(?, 9)', [
          SqlString.raw(col),
          strVal,
        ]),
      );
    } else if (typeof value === 'number') {
      clauses.push(
        SqlString.format('? = ?', [
          SqlString.raw(col),
          SqlString.raw(String(value)),
        ]),
      );
    } else {
      clauses.push(SqlString.format('? = ?', [SqlString.raw(col), strVal]));
    }
  }

  return clauses.join(' AND ');
}

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

  // Use displayedTimestampValueExpression for the Timestamp column,
  // matching getConfig() in DBTraceWaterfallChart which calls
  // getDisplayedTimestampValueExpression(source).
  // This ensures both trace and log queries produce timestamps with
  // the same high precision so they interleave correctly when sorted.
  const tsExpr =
    source.displayedTimestampValueExpression ??
    getFirstTimestampValueExpression(
      source.timestampValueExpression ?? 'TimestampTime',
    ) ??
    source.timestampValueExpression ??
    'TimestampTime';

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

  // Same displayedTimestampValueExpression logic as buildTraceSpansSql
  const tsExpr =
    source.displayedTimestampValueExpression ??
    getFirstTimestampValueExpression(
      source.timestampValueExpression ?? 'TimestampTime',
    ) ??
    source.timestampValueExpression ??
    'TimestampTime';

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
 * Build a raw SELECT * query to fetch all fields for a single row.
 * Bypasses renderChartConfig to avoid extra time range / query wrapping.
 */
export function buildFullRowSql(opts: FullRowQueryOptions): {
  sql: string;
  connectionId: string;
} {
  const { source, row } = opts;

  const db = source.from.databaseName;
  const table = source.from.tableName;
  const whereClause = buildRowWhereClause(row, source);

  // Do NOT include FORMAT — the ClickHouse client sets it via the HTTP protocol
  const sql = `SELECT * FROM ${db}.${table} WHERE ${whereClause} LIMIT 1`;

  return {
    sql,
    connectionId: source.connection,
  };
}
