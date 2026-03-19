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
  /** Lucene search string */
  searchQuery?: string;
  /** Date range */
  startTime: Date;
  endTime: Date;
  /** Max rows */
  limit?: number;
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
  const { source, searchQuery = '', startTime, endTime, limit = 100 } = opts;

  const tsExpr = source.timestampValueExpression ?? 'TimestampTime';
  const firstTsExpr = getFirstTimestampValueExpression(tsExpr) ?? tsExpr;
  const orderBy = source.orderByExpression ?? `${firstTsExpr} DESC`;

  // Use the source's select expression, or build one for traces
  let selectExpr = source.defaultTableSelectExpression ?? '';
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
    limit: { limit },
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
