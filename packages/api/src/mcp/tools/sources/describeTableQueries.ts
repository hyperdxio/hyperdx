import {
  type ChSql,
  chSql,
  tableExpr,
} from '@hyperdx/common-utils/dist/clickhouse';

import type { ClickhouseClient } from '@/clickhouse';
import { MCP_CLICKHOUSE_SETTINGS } from '@/mcp/tools/query/helpers';

export type TableQueryContext = {
  clickhouseClient: Pick<ClickhouseClient, 'query'>;
  connectionId: string;
  signal: AbortSignal;
};

async function queryRows<T>(
  { clickhouseClient, connectionId, signal }: TableQueryContext,
  sql: ChSql,
): Promise<T[]> {
  const response = await clickhouseClient.query<'JSON'>({
    query: sql.sql,
    query_params: sql.params,
    format: 'JSON',
    connectionId,
    clickhouse_settings: MCP_CLICKHOUSE_SETTINGS,
    abort_signal: signal,
  });
  const result = (await response.json()) as { data: T[] };
  return result.data;
}

/** ClickHouse returns 64-bit integers as strings, and NULL for views. */
function toApproxCount(value: string | number | null): number | null {
  if (value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export type SystemTableRow = {
  name: string;
  engine: string;
  total_rows: string | number | null;
};

export type SystemTableDetailRow = SystemTableRow & {
  sorting_key: string;
  primary_key: string;
  partition_key: string;
  comment: string;
  total_bytes: string | number | null;
};

export type SystemColumnRow = {
  name: string;
  type: string;
  default_kind: string;
  default_expression: string;
  comment: string;
  is_in_sorting_key: number;
  is_in_primary_key: number;
};

export type SystemIndexRow = {
  name: string;
  type: string;
  expr: string;
};

export function shapeTableListEntry(row: SystemTableRow) {
  return {
    name: row.name,
    engine: row.engine,
    approxRows: toApproxCount(row.total_rows),
  };
}

export function shapeTableDescription({
  database,
  table,
  columns,
  indices,
}: {
  database: string;
  table: SystemTableDetailRow;
  columns: SystemColumnRow[];
  indices: SystemIndexRow[];
}) {
  return {
    table: {
      database,
      name: table.name,
      engine: table.engine,
      sortingKey: table.sorting_key,
      primaryKey: table.primary_key,
      partitionKey: table.partition_key,
      ...(table.comment && { comment: table.comment }),
      approxTotalRows: toApproxCount(table.total_rows),
      approxTotalBytes: toApproxCount(table.total_bytes),
    },
    columns: columns.map(c => ({
      name: c.name,
      type: c.type,
      ...(c.default_kind && {
        defaultKind: c.default_kind,
        defaultExpression: c.default_expression,
      }),
      ...(c.comment && { comment: c.comment }),
      inSortingKey: Boolean(Number(c.is_in_sorting_key)),
      inPrimaryKey: Boolean(Number(c.is_in_primary_key)),
    })),
    dataSkippingIndices: indices.map(i => ({
      name: i.name,
      type: i.type,
      expression: i.expr,
    })),
  };
}

/** One extra row past `limit` signals that another page exists. */
export function fetchTablePage(
  ctx: TableQueryContext,
  {
    database,
    afterName,
    limit,
  }: { database: string; afterName: string | undefined; limit: number },
) {
  return queryRows<SystemTableRow>(
    ctx,
    chSql`
      SELECT name, engine, total_rows
      FROM system.tables
      WHERE database = ${{ String: database }}
        AND NOT is_temporary
        ${afterName !== undefined ? chSql`AND name > ${{ String: afterName }}` : ''}
      ORDER BY name ASC
      LIMIT ${{ Int32: limit + 1 }}
    `,
  );
}

export async function databaseExists(ctx: TableQueryContext, database: string) {
  const rows = await queryRows<{ name: string }>(
    ctx,
    chSql`SELECT name FROM system.databases WHERE name = ${{ String: database }}`,
  );
  return rows.length > 0;
}

export async function fetchTableDetails(
  ctx: TableQueryContext,
  { database, table }: { database: string; table: string },
) {
  const [tables, columns, indices] = await Promise.all([
    queryRows<SystemTableDetailRow>(
      ctx,
      chSql`
        SELECT name, engine, sorting_key, primary_key, partition_key, comment,
          total_rows, total_bytes
        FROM system.tables
        WHERE database = ${{ String: database }} AND name = ${{ String: table }}
      `,
    ),
    queryRows<SystemColumnRow>(
      ctx,
      chSql`
        SELECT name, type, default_kind, default_expression, comment,
          is_in_sorting_key, is_in_primary_key
        FROM system.columns
        WHERE database = ${{ String: database }} AND table = ${{ String: table }}
        ORDER BY position
      `,
    ),
    queryRows<SystemIndexRow>(
      ctx,
      chSql`
        SELECT name, type, expr
        FROM system.data_skipping_indices
        WHERE database = ${{ String: database }} AND table = ${{ String: table }}
      `,
    ),
  ]);
  return { table: tables[0], columns, indices };
}

export function fetchSampleRows(
  ctx: TableQueryContext,
  {
    database,
    table,
    limit,
  }: { database: string; table: string; limit: number },
) {
  return queryRows<Record<string, unknown>>(
    ctx,
    chSql`SELECT * FROM ${tableExpr({ database, table })} LIMIT ${{ Int32: limit }}`,
  );
}
