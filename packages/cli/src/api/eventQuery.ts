/**
 * Builds ClickHouse SQL for searching events (logs or traces) using
 * renderChartConfig from common-utils.
 */

import type { ChSql } from '@hyperdx/common-utils/dist/clickhouse';
import { renderChartConfig } from '@hyperdx/common-utils/dist/core/renderChartConfig';
import type { Metadata } from '@hyperdx/common-utils/dist/core/metadata';
import { getFirstTimestampValueExpression } from '@hyperdx/common-utils/dist/core/utils';
import { DisplayType } from '@hyperdx/common-utils/dist/types';
import type {
  BuilderChartConfigWithDateRange,
  SelectList,
} from '@hyperdx/common-utils/dist/types';
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
 * Alias names for the full row fetch, matching the web frontend's
 * ROW_DATA_ALIASES enum in DBRowDataPanel.tsx.
 * Uses the same enum shape so it can be moved to common-utils later.
 */
export enum ROW_DATA_ALIASES {
  TIMESTAMP = '__hdx_timestamp',
  BODY = '__hdx_body',
  TRACE_ID = '__hdx_trace_id',
  SPAN_ID = '__hdx_span_id',
  SEVERITY_TEXT = '__hdx_severity_text',
  SERVICE_NAME = '__hdx_service_name',
  RESOURCE_ATTRIBUTES = '__hdx_resource_attributes',
  EVENT_ATTRIBUTES = '__hdx_event_attributes',
  EVENTS_EXCEPTION_ATTRIBUTES = '__hdx_events_exception_attributes',
  SPAN_EVENTS = '__hdx_span_events',
}

/**
 * Parse defaultTableSelectExpression to build a map of alias → expression.
 * E.g. "Timestamp, ServiceName as service, SeverityText as level, Body"
 * → { Timestamp: "Timestamp", service: "ServiceName", level: "SeverityText", Body: "Body" }
 */
function parseSelectAliasMap(
  selectExpr: string | undefined,
): Record<string, string> {
  const map: Record<string, string> = {};
  if (!selectExpr) return map;

  // Split by comma, respecting parentheses (e.g. function calls)
  let depth = 0;
  let current = '';
  const parts: string[] = [];
  for (const ch of selectExpr) {
    if (ch === '(' || ch === '[') depth++;
    else if (ch === ')' || ch === ']') depth--;
    else if (ch === ',' && depth === 0) {
      parts.push(current.trim());
      current = '';
      continue;
    }
    current += ch;
  }
  if (current.trim()) parts.push(current.trim());

  for (const part of parts) {
    // Match "expr AS alias" or "expr as alias"
    const asMatch = part.match(/^(.+?)\s+[Aa][Ss]\s+(\S+)$/);
    if (asMatch) {
      map[asMatch[2]] = asMatch[1].trim();
    } else {
      // No alias — the column name is both key and expression
      // Extract the last identifier as the key (handles dotted paths)
      const name = part.trim();
      const lastDot = name.lastIndexOf('.');
      const key = lastDot >= 0 ? name.slice(lastDot + 1) : name;
      map[key] = name;
    }
  }

  return map;
}

/**
 * Build a WHERE clause to uniquely identify a row for a SELECT * lookup.
 *
 * Maps the row's aliased column names back to source table expressions
 * using the defaultTableSelectExpression alias mapping. This ensures the
 * WHERE clause uses actual ClickHouse column/expression names.
 *
 * This mirrors the web frontend's processRowToWhereClause + aliasMap.
 */
function buildRowWhereClause(
  row: Record<string, unknown>,
  source: SourceResponse,
): string {
  const aliasMap = parseSelectAliasMap(source.defaultTableSelectExpression);
  const clauses: string[] = [];
  const tsPattern = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}/;

  for (const [col, value] of Object.entries(row)) {
    if (value == null) continue;
    if (typeof value === 'object') continue;

    const strVal = String(value);
    if (strVal === '') continue;
    if (strVal.length > 512) continue;

    // Resolve the alias to the actual expression, fall back to col name
    const expr = aliasMap[col] ?? col;

    if (tsPattern.test(strVal)) {
      clauses.push(
        SqlString.format('? = parseDateTime64BestEffort(?, 9)', [
          SqlString.raw(expr),
          strVal,
        ]),
      );
    } else if (typeof value === 'number') {
      clauses.push(
        SqlString.format('? = ?', [SqlString.raw(expr), SqlString.raw(strVal)]),
      );
    } else {
      clauses.push(SqlString.format('? = ?', [SqlString.raw(expr), strVal]));
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
 * Build the SELECT list with __hdx_* aliases, matching the web frontend's
 * useRowData in DBRowDataPanel.tsx.
 * Same function shape so it can be moved to common-utils later.
 */
function buildRowDataSelectList(source: SourceResponse): SelectList {
  const select: SelectList = [{ valueExpression: '*' }];

  const add = (expr: string | undefined, alias: string) => {
    if (expr) select.push({ valueExpression: expr, alias });
  };

  // Timestamp — use displayedTimestampValueExpression for high precision
  const displayedTs =
    source.displayedTimestampValueExpression ??
    getFirstTimestampValueExpression(
      source.timestampValueExpression ?? 'TimestampTime',
    ) ??
    source.timestampValueExpression ??
    'TimestampTime';
  add(displayedTs, ROW_DATA_ALIASES.TIMESTAMP);

  add(
    source.bodyExpression ?? source.spanNameExpression,
    ROW_DATA_ALIASES.BODY,
  );
  add(source.traceIdExpression, ROW_DATA_ALIASES.TRACE_ID);
  add(source.spanIdExpression, ROW_DATA_ALIASES.SPAN_ID);
  add(source.serviceNameExpression, ROW_DATA_ALIASES.SERVICE_NAME);

  if (source.kind === 'log') {
    add(source.severityTextExpression, ROW_DATA_ALIASES.SEVERITY_TEXT);
  } else if (source.kind === 'trace') {
    add(source.statusCodeExpression, ROW_DATA_ALIASES.SEVERITY_TEXT);
  }

  add(
    source.resourceAttributesExpression,
    ROW_DATA_ALIASES.RESOURCE_ATTRIBUTES,
  );
  add(source.eventAttributesExpression, ROW_DATA_ALIASES.EVENT_ATTRIBUTES);

  return select;
}

/**
 * Build a full row SQL query matching the web frontend's useRowData
 * in DBRowDataPanel.tsx.
 *
 * SELECT *, <__hdx_* aliases>
 * FROM db.table
 * WHERE <row values matched via alias→expression mapping>
 * LIMIT 1
 *
 * The WHERE clause uses buildRowWhereClause which resolves aliased
 * column names (from defaultTableSelectExpression) back to actual
 * table column expressions.
 */
export function buildFullRowSql(opts: FullRowQueryOptions): {
  sql: string;
  connectionId: string;
} {
  const { source, row } = opts;

  const db = source.from.databaseName;
  const table = source.from.tableName;
  const whereClause = buildRowWhereClause(row, source);
  const selectList = buildRowDataSelectList(source);

  // Build the SELECT clause: *, then each __hdx_* alias
  const selectParts: string[] = [];
  if (typeof selectList === 'string') {
    selectParts.push(selectList);
  } else {
    for (const s of selectList) {
      if ('valueExpression' in s) {
        selectParts.push(
          s.alias ? `${s.valueExpression} AS ${s.alias}` : s.valueExpression,
        );
      }
    }
  }

  const sql = `SELECT ${selectParts.join(', ')} FROM ${db}.${table} WHERE ${whereClause} LIMIT 1`;

  return {
    sql,
    connectionId: source.connection,
  };
}
