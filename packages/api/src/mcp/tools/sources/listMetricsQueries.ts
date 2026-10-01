import {
  type ChSql,
  chSql,
  concatChSql,
  tableExpr,
} from '@hyperdx/common-utils/dist/clickhouse';
import SqlString from 'sqlstring';

import type { ClickhouseClient } from '@/clickhouse';

// Both queries use timeout_overflow_mode: 'break' so ClickHouse returns what
// it has read when the cap is hit instead of failing.
async function queryRows<T>({
  clickhouseClient,
  sql,
  connectionId,
  maxExecutionSeconds,
  signal,
}: {
  clickhouseClient: ClickhouseClient;
  sql: ChSql;
  connectionId: string;
  maxExecutionSeconds: number;
  signal: AbortSignal;
}): Promise<T[]> {
  const response = await clickhouseClient.query<'JSON'>({
    query: sql.sql,
    query_params: sql.params,
    format: 'JSON',
    connectionId,
    clickhouse_settings: {
      max_execution_time: maxExecutionSeconds,
      timeout_overflow_mode: 'break',
    },
    abort_signal: signal,
  });
  const result = (await response.json()) as { data: T[] };
  return result.data;
}

/**
 * Distinct metric names for one kind. Reads only MetricName and TimeUnix;
 * unit and description are fetched separately for the returned page, since
 * aggregating those String columns across the whole window was the bulk of
 * the bytes read.
 */
export async function fetchMetricNames({
  clickhouseClient,
  databaseName,
  tableName,
  connectionId,
  startDate,
  endDate,
  namePattern,
  afterName,
  limit,
  maxExecutionSeconds,
  signal,
}: {
  clickhouseClient: ClickhouseClient;
  databaseName: string;
  tableName: string;
  connectionId: string;
  startDate: Date;
  endDate: Date;
  namePattern: string | undefined;
  afterName: string | undefined;
  limit: number;
  maxExecutionSeconds: number;
  signal: AbortSignal;
}): Promise<string[]> {
  const whereParts = [
    chSql`TimeUnix >= fromUnixTimestamp64Milli(${{ Int64: startDate.getTime() }})`,
    chSql`TimeUnix <= fromUnixTimestamp64Milli(${{ Int64: endDate.getTime() }})`,
    ...(afterName !== undefined
      ? [chSql`MetricName > ${{ String: afterName }}`]
      : []),
    ...(namePattern
      ? [chSql`MetricName ILIKE ${{ String: namePattern }}`]
      : []),
  ];

  const sql = chSql`
    SELECT MetricName
    FROM ${tableExpr({ database: databaseName, table: tableName })}
    WHERE ${concatChSql(' AND ', whereParts)}
    GROUP BY MetricName
    ORDER BY MetricName ASC
    LIMIT ${{ Int32: limit }}
  `;

  const rows = await queryRows<{ MetricName: string }>({
    clickhouseClient,
    sql,
    connectionId,
    maxExecutionSeconds,
    signal,
  });
  return rows.map(row => row.MetricName);
}

/**
 * Unit and description for a page of metric names. `LIMIT 1 BY` plus the
 * outer LIMIT lets ClickHouse stop reading once every name has a row, instead
 * of aggregating every point in the window. The row picked is arbitrary, which
 * matches the `anyLast` this replaced; unit and description are effectively
 * constant per metric.
 */
export async function fetchMetricUnitsAndDescriptions({
  clickhouseClient,
  databaseName,
  tableName,
  connectionId,
  names,
  startDate,
  endDate,
  hasUnit,
  hasDescription,
  maxExecutionSeconds,
  signal,
}: {
  clickhouseClient: ClickhouseClient;
  databaseName: string;
  tableName: string;
  connectionId: string;
  names: string[];
  startDate: Date;
  endDate: Date;
  hasUnit: boolean;
  hasDescription: boolean;
  maxExecutionSeconds: number;
  signal: AbortSignal;
}): Promise<Map<string, { unit?: string; description?: string }>> {
  const enrichments = new Map<
    string,
    { unit?: string; description?: string }
  >();
  if (names.length === 0 || (!hasUnit && !hasDescription)) return enrichments;

  const projections = [
    chSql`MetricName`,
    ...(hasUnit ? [chSql`${{ Identifier: 'MetricUnit' }}`] : []),
    ...(hasDescription ? [chSql`${{ Identifier: 'MetricDescription' }}`] : []),
  ];
  const sql = chSql`
    SELECT ${concatChSql(', ', projections)}
    FROM ${tableExpr({ database: databaseName, table: tableName })}
    WHERE MetricName IN (${{
      // Inline names as escaped literals: one bind param per name (up to
      // 500) pushes the client into a multipart request that query proxies
      // can reject.
      UNSAFE_RAW_SQL: names.map(name => SqlString.escape(name)).join(','),
    }})
      AND TimeUnix >= fromUnixTimestamp64Milli(${{ Int64: startDate.getTime() }})
      AND TimeUnix <= fromUnixTimestamp64Milli(${{ Int64: endDate.getTime() }})
    LIMIT 1 BY MetricName
    LIMIT ${{ Int32: names.length }}
  `;

  const rows = await queryRows<{
    MetricName: string;
    MetricUnit?: string;
    MetricDescription?: string;
  }>({ clickhouseClient, sql, connectionId, maxExecutionSeconds, signal });
  for (const row of rows) {
    enrichments.set(row.MetricName, {
      ...(row.MetricUnit ? { unit: row.MetricUnit } : {}),
      ...(row.MetricDescription ? { description: row.MetricDescription } : {}),
    });
  }
  return enrichments;
}
