/**
 * Berg-side ChartConfig query bridge.
 *
 * Shape-compatible with the deleted `ClickhouseClient` so chart hooks
 * (`useQueriedChartConfig`, `useOffsetPaginatedQuery`, etc.) keep working
 * without per-call refactoring. Internally it routes the rendered SQL
 * through `/api/v1/query` (Athena/Trino), reshapes the response into the
 * legacy ResponseJSON envelope the chart renderers expect.
 */
import objectHash from 'object-hash';
import {
  renderChartConfig,
  setChartSelectsAlias,
  splitChartConfigs,
} from '@berg/common-utils/dist/core/renderChartConfig';
import { isBuilderChartConfig } from '@berg/common-utils/dist/guards';
import {
  ChartConfigWithOptDateRange,
  QuerySettings,
} from '@berg/common-utils/dist/types';
import { useQuery, UseQueryOptions } from '@tanstack/react-query';

import api from '@/api';
import { ClickhouseClient, ColumnMeta, ResponseJSON } from '@/clickhouse-types';
import { DEFAULT_QUERY_TIMEOUT } from '@/defaults';

export type ClickhouseClientOptions = {
  host?: string;
  username?: string;
  password?: string;
  queryTimeout?: number;
  application?: string;
  requestTimeout?: number;
};

function trinoTypeToCHType(trinoType: string, jsType?: string): string {
  const normalised = (jsType ?? trinoType).toLowerCase();
  if (
    normalised === 'string' ||
    normalised.startsWith('varchar') ||
    normalised.startsWith('char')
  )
    return 'String';
  if (normalised === 'number') {
    if (trinoType.toLowerCase().startsWith('bigint')) return 'Int64';
    if (
      trinoType.toLowerCase().startsWith('integer') ||
      trinoType.toLowerCase().startsWith('int')
    )
      return 'Int32';
    if (trinoType.toLowerCase().startsWith('smallint')) return 'Int16';
    if (trinoType.toLowerCase().startsWith('tinyint')) return 'Int8';
    if (
      trinoType.toLowerCase().startsWith('real') ||
      trinoType.toLowerCase().startsWith('float')
    )
      return 'Float32';
    return 'Float64';
  }
  if (normalised === 'boolean' || normalised === 'bool') return 'Bool';
  if (normalised === 'date') {
    if (
      trinoType.toLowerCase().startsWith('date') &&
      !trinoType.toLowerCase().startsWith('datetime')
    )
      return 'Date';
    return 'DateTime';
  }
  if (normalised.startsWith('array')) return 'Array(String)';
  if (normalised.startsWith('map')) return 'Map(String, String)';
  if (normalised.startsWith('row') || normalised.startsWith('tuple'))
    return 'Tuple(String)';
  if (normalised === 'json') return 'JSON';
  return 'String';
}

interface BergQueryResponse {
  rows?: Record<string, unknown>[];
  schema?: { name: string; type: string; jsType?: string }[];
  scannedBytes?: number;
  status?: string;
  executionId?: string;
}

async function postBergQuery(
  sql: string,
  signal?: AbortSignal,
  // sourceId, when supplied, lets the API resolve the Source's catalog
  // and database into Athena's QueryExecutionContext so the SQL can use
  // bare two-part identifiers (`"db"."table"`) without three-part
  // qualification. Without it the API falls back to GLUE_CATALOG_ID.
  sourceId?: string,
): Promise<{
  data: any[];
  meta: { name: string; type: string }[];
  rows: number;
  statistics: any;
}> {
  if (typeof window === 'undefined' || typeof fetch === 'undefined') {
    return {
      data: [],
      meta: [],
      rows: 0,
      statistics: { elapsed: 0, rows_read: 0, bytes_read: 0 },
    };
  }
  const trimmed = sql.trim();
  const lower = trimmed.toLowerCase();

  // The chart-config emitter, Lucene parser, filter-chip builder and a few
  // other call paths still ask the metadata layer for column lists by
  // issuing `DESCRIBE \`db\`.\`table\``.  Berg has no ClickHouse, so route
  // those through Glue (via the source's catalog).  We need a sourceId to
  // resolve the catalog, otherwise return empty so the caller can decide
  // how to handle the missing schema.
  const describeMatch = trimmed.match(
    /^describe\s+`([^`]+)`\s*\.\s*`([^`]+)`\s*$/i,
  );
  if (describeMatch && sourceId) {
    const [, database, table] = describeMatch;
    try {
      const params = new URLSearchParams({ database, table });
      const response = await fetch(
        `/api/sources/${encodeURIComponent(sourceId)}/columns?${params}`,
        { credentials: 'include', signal },
      );
      if (!response.ok) {
        return {
          data: [],
          meta: [],
          rows: 0,
          statistics: { elapsed: 0, rows_read: 0, bytes_read: 0 },
        };
      }
      const body: { columns?: { name: string; type: string }[] } =
        await response.json();
      const data = (body.columns ?? []).map(c => ({
        name: c.name,
        type: c.type,
      }));
      return {
        data,
        meta: [
          { name: 'name', type: 'String' },
          { name: 'type', type: 'String' },
        ],
        rows: data.length,
        statistics: { elapsed: 0, rows_read: data.length, bytes_read: 0 },
      };
    } catch (err) {
      console.warn('Berg getColumns fetch failed', err);
      return {
        data: [],
        meta: [],
        rows: 0,
        statistics: { elapsed: 0, rows_read: 0, bytes_read: 0 },
      };
    }
  }

  if (
    lower.startsWith('describe') ||
    lower.startsWith('show ') ||
    lower.includes(' system.') ||
    lower.startsWith('system.') ||
    lower.startsWith('explain')
  ) {
    return {
      data: [],
      meta: [],
      rows: 0,
      statistics: { elapsed: 0, rows_read: 0, bytes_read: 0 },
    };
  }
  let response: Response;
  try {
    response = await fetch('/api/v1/query', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(sourceId ? { sql, sourceId } : { sql }),
      signal,
    });
  } catch (err) {
    console.warn('Berg query fetch failed', err);
    return {
      data: [],
      meta: [],
      rows: 0,
      statistics: { elapsed: 0, rows_read: 0, bytes_read: 0 },
    };
  }
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(
      `Berg query failed (${response.status} ${response.statusText}): ${text}`,
    );
  }
  const result: BergQueryResponse = await response.json();
  const data = result.rows ?? [];
  const meta = (result.schema ?? []).map(col => ({
    name: col.name,
    type: trinoTypeToCHType(col.type, col.jsType),
  }));
  return {
    data,
    meta,
    rows: data.length,
    statistics: {
      elapsed: 0,
      rows_read: data.length,
      bytes_read: result.scannedBytes ?? 0,
    },
  };
}

function interpolateParams(sql: string, params: Record<string, any>): string {
  let out = sql;
  for (const [name, value] of Object.entries(params)) {
    const placeholder = new RegExp(`\\{${name}:[A-Za-z0-9_]+\\}`, 'g');
    let literal: string;
    if (typeof value === 'string') {
      literal = `'${value.replace(/'/g, "''")}'`;
    } else if (typeof value === 'number' || typeof value === 'boolean') {
      literal = String(value);
    } else {
      literal = `'${String(value).replace(/'/g, "''")}'`;
    }
    out = out.replace(placeholder, literal);
  }
  return out;
}

function makeBergClient(_options: ClickhouseClientOptions): ClickhouseClient {
  return {
    async query<F>(input: any) {
      const sql = interpolateParams(input.query, input.query_params ?? {});
      // Legacy chart-configs carried the source ID under `connectionId`
      // (the field name pre-dates Berg). When the caller passes one, we
      // forward it as Berg's `sourceId` so the API can scope to the
      // Source's catalog/database via QueryExecutionContext.
      const result = await postBergQuery(
        sql,
        input.abort_signal,
        input.connectionId,
      );
      void input.format as F | undefined;
      // Berg's /v1/query is non-streaming; expose a synthetic stream that
      // returns the full result in one chunk so the legacy
      // useOffsetPaginatedQuery streaming reader degrades to a single read.
      //
      // The reader expects ClickHouse's `JSONCompactEachRowWithNamesAndTypes`
      // shape: first row = column names array, second row = column types
      // array, subsequent rows = arrays of column values in the same order.
      // We rebuild that shape from the row-objects + meta the API gives us.
      const columnNames = result.meta.map(m => m.name);
      const columnTypes = result.meta.map(m => m.type);
      const dataRowsArr = result.data.map(row =>
        columnNames.map(name => (row as Record<string, unknown>)[name]),
      );
      const streamRows: unknown[] = [columnNames, columnTypes, ...dataRowsArr];
      let consumed = false;
      return {
        json: async <T extends Record<string, unknown>>() =>
          result as unknown as ResponseJSON<T>,
        stream: () => ({
          getReader: () => ({
            read: async () => {
              if (consumed) return { done: true };
              consumed = true;
              return {
                done: false,
                value: streamRows.map(r => ({
                  json: <U>() => r as unknown as U,
                })),
              };
            },
          }),
        }),
      };
    },
    async queryChartConfig({ config, metadata, opts, querySettings }) {
      config = isBuilderChartConfig(config)
        ? setChartSelectsAlias(config)
        : config;
      const queries = await Promise.all(
        splitChartConfigs(config as ChartConfigWithOptDateRange).map(
          (c: ChartConfigWithOptDateRange) =>
            renderChartConfig(c, metadata, querySettings as QuerySettings),
        ),
      );
      // Chart-config plumbing carries the Source ID on `config.connection`
      // (legacy field name). Pass it through so the API resolves the
      // Source's federated catalog/database for QueryExecutionContext.
      const sourceId =
        typeof (config as { connection?: unknown }).connection === 'string'
          ? (config as { connection?: string }).connection
          : undefined;
      const resultSets = await Promise.all(
        queries.map(q => {
          const sql = interpolateParams(q.sql, q.params);
          return postBergQuery(sql, opts?.abort_signal, sourceId);
        }),
      );
      if (resultSets.length === 1) return resultSets[0];
      // For multiple SELECTs (e.g. ratio mode), merge by hashed timestamp.
      const metaSet = new Map<string, { name: string; type: string }>();
      const tsBucketMap = new Map<string, Record<string, any>>();
      for (const rs of resultSets) {
        for (const m of rs.meta) {
          if (!metaSet.has(m.name)) metaSet.set(m.name, m);
        }
        for (const row of rs.data) {
          const ts = objectHash(row);
          tsBucketMap.set(ts, { ...(tsBucketMap.get(ts) ?? {}), ...row });
        }
      }
      return {
        meta: Array.from(metaSet.values()),
        data: Array.from(tsBucketMap.values()),
        rows: tsBucketMap.size,
        statistics: { elapsed: 0, rows_read: tsBucketMap.size, bytes_read: 0 },
      };
    },
  };
}

export const getClickhouseClient = (
  options: ClickhouseClientOptions = {},
): ClickhouseClient => {
  return makeBergClient(options);
};

export const useClickhouseClient = (
  options: ClickhouseClientOptions = {},
): ClickhouseClient => {
  const { data: me } = api.useMe();
  const teamQueryTimeout = me?.team?.queryTimeout;
  if (teamQueryTimeout !== undefined) {
    options.queryTimeout = teamQueryTimeout;
  } else {
    options.queryTimeout = DEFAULT_QUERY_TIMEOUT;
  }
  return getClickhouseClient(options);
};

// Berg has no SHOW DATABASES / SHOW TABLES — Catalog page uses the Glue
// /catalogs and /databases endpoints. These hooks are kept as no-op stubs
// so the few SQL-editor / clickhouse-page references compile.
export function useDatabasesDirect(
  { connectionId }: { connectionId: string },
  options?: Omit<UseQueryOptions<any, Error>, 'queryKey'>,
) {
  void connectionId;
  return useQuery<ResponseJSON<ColumnMeta>, Error>({
    queryKey: [`direct_datasources/databases`, connectionId],
    queryFn: async () => ({
      data: [],
      meta: [],
      rows: 0,
    }),
    staleTime: 1000 * 60 * 5,
    ...options,
  });
}

export function useTablesDirect(
  { database, connectionId }: { database: string; connectionId: string },
  options?: Omit<UseQueryOptions<any, Error>, 'queryKey'>,
) {
  void database;
  void connectionId;
  return useQuery<ResponseJSON<ColumnMeta>, Error>({
    queryKey: [`direct_datasources/databases/${database}/tables`, connectionId],
    queryFn: async () => ({
      data: [],
      meta: [],
      rows: 0,
    }),
    staleTime: 1000 * 60 * 5,
    ...options,
  });
}
