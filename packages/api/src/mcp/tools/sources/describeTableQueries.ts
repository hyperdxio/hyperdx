import type { ClickHouseSettings } from '@clickhouse/client-common';
import {
  type ChSql,
  chSql,
  tableExpr,
} from '@hyperdx/common-utils/dist/clickhouse';
import type {
  SkipIndexMetadata,
  TableMetadata,
} from '@hyperdx/common-utils/dist/core/metadata';
import { getDistributedTableArgs } from '@hyperdx/common-utils/dist/core/utils';

import type { ClickhouseClient } from '@/clickhouse';
import { MCP_CLICKHOUSE_SETTINGS } from '@/mcp/tools/query/helpers';
import logger from '@/utils/logger';

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
  localTableEngine,
  columns,
  indices,
}: {
  database: string;
  table: TableInfo;
  keys: TableKeys;
  distributedTarget?: DistributedTarget;
  /** Unset when the local table could not be read. */
  localTableEngine?: string;
  columns: SystemColumnRow[];
  indices: Pick<SkipIndexMetadata, 'name' | 'type' | 'expression'>[];
}) {
  return {
    table: {
      database,
      name: table.name,
      engine: table.engine,
      ...(distributedTarget && {
        localTable: {
          ...distributedTarget,
          ...(localTableEngine && { engine: localTableEngine }),
        },
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

type SystemTableName = 'tables' | 'columns' | 'data_skipping_indices';

/** A system table, read across the cluster when `cluster` is set. */
function systemTable(name: SystemTableName, cluster?: string): ChSql {
  return cluster
    ? chSql`cluster(${{ String: cluster }}, system.${name})`
    : chSql`system.${name}`;
}

export function isPrivilegeError(e: unknown) {
  const message = e instanceof Error ? e.message : String(e);
  return /ACCESS_DENIED|NOT_ENOUGH_PRIVILEGES|Not enough privileges/i.test(
    message,
  );
}

/** Resolves to null instead of rejecting when the user lacks a grant. */
function nullOnPrivilegeError<T>(query: Promise<T>): Promise<T | null> {
  return query.catch((e: unknown) => {
    if (isPrivilegeError(e)) return null;
    throw e;
  });
}

/**
 * Resolves to null on any failure. The cluster() lookups can fail for reasons
 * besides grants (unknown cluster, unreachable shard), and the Distributed
 * table's own schema is still worth returning.
 */
function nullOnFailure<T>(query: Promise<T>): Promise<T | null> {
  return query.catch((e: unknown) => {
    logger.warn({ error: e }, 'Distributed local-table lookup failed');
    return null;
  });
}

/**
 * Returns undefined when the table does not exist or is not visible. Every
 * lookup is uncached so the result reflects ALTERs made since the last call.
 */
export async function fetchTableDetails(
  ctx: TableQueryContext,
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

  // A Distributed table has no keys or indices of its own; read them from
  // the local table it routes to.
  const distributedTarget =
    info.engine === 'Distributed' ? getDistributedTableArgs(info) : undefined;
  const keyTable = distributedTarget ?? { database, table, cluster: undefined };

  const [localKeys, indices, columns, localKeyFlags] = await Promise.all([
    distributedTarget
      ? nullOnFailure(
          queryRows<TableKeys>(
            ctx,
            chSql`
            SELECT engine, sorting_key, primary_key, partition_key
            FROM ${systemTable('tables', keyTable.cluster)}
            WHERE database = ${{ String: keyTable.database }}
              AND name = ${{ String: keyTable.table }}
            LIMIT 1
          `,
          ),
        )
      : undefined,
    // Indices and the local-table lookups are optional detail, and cluster()
    // needs the REMOTE grant; a missing grant should not hide the schema.
    (distributedTarget ? nullOnFailure : nullOnPrivilegeError)(
      queryRows<Pick<SkipIndexMetadata, 'name' | 'type' | 'expression'>>(
        ctx,
        chSql`
        SELECT name, type, expr AS expression
        FROM ${systemTable('data_skipping_indices', keyTable.cluster)}
        WHERE database = ${{ String: keyTable.database }}
          AND table = ${{ String: keyTable.table }}
        LIMIT 1 BY name
      `,
      ),
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
    distributedTarget
      ? nullOnFailure(
          queryRows<ColumnKeyFlags>(
            ctx,
            chSql`
            SELECT name, is_in_sorting_key, is_in_primary_key
            FROM ${systemTable('columns', keyTable.cluster)}
            WHERE database = ${{ String: keyTable.database }}
              AND table = ${{ String: keyTable.table }}
            LIMIT 1 BY name
          `,
          ),
        )
      : undefined,
  ]);

  const localKeyRow = localKeys?.at(0);
  const flagsByName = new Map(localKeyFlags?.map(f => [f.name, f]));
  return {
    table: info,
    keys: localKeyRow ?? info,
    distributedTarget,
    localTableEngine: localKeyRow?.engine,
    indices: indices ?? [],
    indicesUnavailable: indices === null,
    localTableUnavailable:
      distributedTarget != null && (!localKeyRow || localKeyFlags === null),
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

// Five rows of wide String columns can still be large. Past this cap
// ClickHouse fails the query, which surfaces as sampleRowsError, so nothing
// unbounded is buffered.
const SAMPLE_MAX_RESULT_BYTES = 1_000_000;
// Well inside the tool's budget, which the schema queries have already used
// part of, so a slow sample fails on its own instead of timing out the call.
const SAMPLE_MAX_EXECUTION_SEC = 10;

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
    {
      max_result_bytes: SAMPLE_MAX_RESULT_BYTES.toString(),
      max_execution_time: SAMPLE_MAX_EXECUTION_SEC,
    },
  );
}
