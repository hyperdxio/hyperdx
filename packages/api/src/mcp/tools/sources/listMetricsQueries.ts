import {
  type ChSql,
  chSql,
  concatChSql,
  tableExpr,
} from '@hyperdx/common-utils/dist/clickhouse';
import type { getMetadata } from '@hyperdx/common-utils/dist/core/metadata';
import SqlString from 'sqlstring';

import type { ClickhouseClient } from '@/clickhouse';
import logger from '@/utils/logger';

import type { MetricEntry } from './listMetricsPage';
import type { DiscoverableMetricKind } from './metricKinds';

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
async function fetchMetricUnitsAndDescriptions({
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

type Enrichments = Awaited<ReturnType<typeof fetchMetricUnitsAndDescriptions>>;

/**
 * Attach unit and description to each entry. Best effort: on failure or
 * timeout the names are still returned.
 */
export async function enrichEntries({
  entries,
  clickhouseClient,
  metadata,
  databaseName,
  metricTables,
  connectionId,
  startDate,
  endDate,
  maxExecutionSeconds,
  signal,
}: {
  entries: MetricEntry[];
  clickhouseClient: ClickhouseClient;
  metadata: ReturnType<typeof getMetadata>;
  databaseName: string;
  metricTables: Partial<Record<DiscoverableMetricKind, string>>;
  connectionId: string;
  startDate: Date;
  endDate: Date;
  maxExecutionSeconds: number;
  signal: AbortSignal;
}): Promise<MetricEntry[]> {
  const kinds = [...new Set(entries.map(e => e.kind))];
  // metadata.getColumns takes no abort signal, so race the whole lookup
  // against it; otherwise a slow schema lookup could outlast the call's
  // wall clock and discard the names already collected.
  const aborted = new Promise<undefined>(resolve => {
    if (signal.aborted) resolve(undefined);
    signal.addEventListener('abort', () => resolve(undefined), { once: true });
  });
  const lookups = Promise.all(
    kinds.map(async (kind): Promise<[DiscoverableMetricKind, Enrichments]> => {
      const tableName = metricTables[kind]!;
      try {
        // Skip MetricUnit / MetricDescription on non-OTel-default schemas.
        const columns = await metadata.getColumns({
          databaseName,
          tableName,
          connectionId,
        });
        const columnNames = new Set(columns.map(c => c.name));
        const enrichments = await fetchMetricUnitsAndDescriptions({
          clickhouseClient,
          databaseName,
          tableName,
          connectionId,
          names: entries.filter(e => e.kind === kind).map(e => e.name),
          startDate,
          endDate,
          hasUnit: columnNames.has('MetricUnit'),
          hasDescription: columnNames.has('MetricDescription'),
          maxExecutionSeconds,
          signal,
        });
        return [kind, enrichments];
      } catch (e) {
        logger.warn(
          { kind, tableName, error: e instanceof Error ? e.message : e },
          'Failed to fetch metric unit/description',
        );
        return [kind, new Map()];
      }
    }),
  );
  const byKind = await Promise.race([lookups, aborted]);
  if (!byKind) {
    logger.warn(
      { kinds },
      'Timed out fetching metric unit/description; returning names only',
    );
    return entries;
  }
  const enrichments = new Map(byKind);
  return entries.map(entry => ({
    ...entry,
    ...enrichments.get(entry.kind)?.get(entry.name),
  }));
}
