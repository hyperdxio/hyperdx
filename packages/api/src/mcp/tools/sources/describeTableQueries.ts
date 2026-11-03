import type { ClickHouseSettings } from '@clickhouse/client-common';
import {
  type ChSql,
  chSql,
  tableExpr,
} from '@hyperdx/common-utils/dist/clickhouse';
import type {
  Metadata,
  SkipIndexMetadata,
  TableMetadata,
} from '@hyperdx/common-utils/dist/core/metadata';
import { getDistributedTableArgs } from '@hyperdx/common-utils/dist/core/utils';

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
  settings?: ClickHouseSettings,
): Promise<T[]> {
  const response = await clickhouseClient.query<'JSON'>({
    query: sql.sql,
    query_params: sql.params,
    format: 'JSON',
    connectionId,
    clickhouse_settings: { ...MCP_CLICKHOUSE_SETTINGS, ...settings },
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

// total_rows / total_bytes are NULL for views, unlike TableMetadata's typing.
type TableInfo = Pick<TableMetadata, 'name' | 'engine' | 'comment'> & {
  total_rows: string | null;
  total_bytes: string | null;
};

type TableKeys = Pick<
  TableMetadata,
  'engine' | 'sorting_key' | 'primary_key' | 'partition_key'
>;

type ColumnKeyFlags = {
  name: string;
  is_in_sorting_key: number;
  is_in_primary_key: number;
};

export type SystemColumnRow = ColumnKeyFlags & {
  type: string;
  default_kind: string;
  default_expression: string;
  comment: string;
};

type DistributedTarget = { cluster: string; database: string; table: string };

export function shapeTableListEntry(row: SystemTableRow) {
  return {
    name: row.name,
    engine: row.engine,
    approxTotalRows: toApproxCount(row.total_rows),
  };
}

/**
 * `keys` comes from the local table when `table` is Distributed, since a
 * Distributed table has no keys or indices of its own.
 */
export function shapeTableDescription({
  database,
  table,
  keys,
  distributedTarget,
  columns,
  indices,
}: {
  database: string;
  table: TableInfo;
  keys: TableKeys;
  distributedTarget?: DistributedTarget;
  columns: SystemColumnRow[];
  indices: Pick<SkipIndexMetadata, 'name' | 'type' | 'expression'>[];
}) {
  return {
    table: {
      database,
      name: table.name,
      engine: table.engine,
      ...(distributedTarget && {
        localTable: { ...distributedTarget, engine: keys.engine },
      }),
      sortingKey: keys.sorting_key,
      primaryKey: keys.primary_key,
      partitionKey: keys.partition_key,
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
      expression: i.expression,
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

/** Returns undefined when the table does not exist or is not visible. */
export async function fetchTableDetails(
  ctx: TableQueryContext,
  metadata: Pick<Metadata, 'getTableMetadata' | 'getSkipIndices'>,
  { database, table }: { database: string; table: string },
) {
  const rows = await queryRows<TableMetadata>(
    ctx,
    chSql`
      SELECT * FROM system.tables
      WHERE database = ${{ String: database }} AND name = ${{ String: table }}
      LIMIT 1
    `,
  );
  const info = rows.at(0);
  if (!info) return undefined;

  const distributedTarget =
    info.engine === 'Distributed' ? getDistributedTableArgs(info) : undefined;
  const metadataArgs = {
    databaseName: database,
    tableName: table,
    connectionId: ctx.connectionId,
  };
  const [keys, indices, columns, localKeyFlags] = await Promise.all([
    metadata.getTableMetadata(metadataArgs),
    metadata.getSkipIndices(metadataArgs),
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
    distributedTarget
      ? queryRows<ColumnKeyFlags>(
          ctx,
          chSql`
            SELECT name, is_in_sorting_key, is_in_primary_key
            FROM cluster(${{ String: distributedTarget.cluster }}, system.columns)
            WHERE database = ${{ String: distributedTarget.database }}
              AND table = ${{ String: distributedTarget.table }}
            LIMIT 1 BY name
          `,
        )
      : undefined,
  ]);

  const flagsByName = new Map(localKeyFlags?.map(f => [f.name, f]));
  return {
    table: info,
    keys: keys ?? info,
    distributedTarget,
    indices,
    columns: columns.map(c => {
      const flags = flagsByName.get(c.name);
      return flags
        ? {
            ...c,
            is_in_sorting_key: flags.is_in_sorting_key,
            is_in_primary_key: flags.is_in_primary_key,
          }
        : c;
    }),
  };
}

// Five rows of wide String columns can still be large; cap what ClickHouse
// sends back so the response is bounded before it is buffered.
const SAMPLE_MAX_RESULT_BYTES = 1_000_000;

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
    { max_result_bytes: SAMPLE_MAX_RESULT_BYTES.toString() },
  );
}
