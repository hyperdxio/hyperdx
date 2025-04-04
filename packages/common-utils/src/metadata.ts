import {
  ChSql,
  chSql,
  ClickhouseClient,
  ColumnMeta,
  convertCHDataTypeToJSType,
  filterColumnMetaByType,
  JSDataType,
  tableExpr,
} from '@/clickhouse';
import { renderChartConfig } from '@/renderChartConfig';
import type { ChartConfig, ChartConfigWithDateRange, TSource } from '@/types';

const DEFAULT_SAMPLE_SIZE = 1e6;

export class MetadataCache {
  private cache = new Map<string, any>();
  private pendingQueries = new Map<string, Promise<any>>();

  // this should be getOrUpdate... or just query to follow react query
  get<T>(key: string): T | undefined {
    return this.cache.get(key);
  }

  async getOrFetch<T>(key: string, query: () => Promise<T>): Promise<T> {
    // Check if value exists in cache
    const cachedValue = this.cache.get(key) as T | undefined;
    if (cachedValue != null) {
      return cachedValue;
    }

    // Check if there is a pending query
    if (this.pendingQueries.has(key)) {
      return this.pendingQueries.get(key)!;
    }

    // If no pending query, initiate the new query
    const queryPromise = query();

    // Store the pending query promise
    this.pendingQueries.set(key, queryPromise);

    try {
      const result = await queryPromise;
      this.cache.set(key, result);
      return result;
    } finally {
      // Clean up the pending query map
      this.pendingQueries.delete(key);
    }
  }

  set<T>(key: string, value: T) {
    return this.cache.set(key, value);
  }

  // TODO: This needs to be async, and use tanstack query on frontend for cache
  // TODO: Implement locks for refreshing
  // TODO: Shard cache by time
}

export type TableMetadata = {
  database: string;
  name: string;
  uuid: string;
  engine: string;
  is_temporary: number;
  data_paths: string[];
  metadata_path: string;
  metadata_modification_time: string;
  metadata_version: number;
  create_table_query: string;
  engine_full: string;
  as_select: string;
  partition_key: string;
  sorting_key: string;
  primary_key: string;
  sampling_key: string;
  storage_policy: string;
  total_rows: string;
  total_bytes: string;
  total_bytes_uncompressed: string;
  parts: string;
  active_parts: string;
  total_marks: string;
  comment: string;
};

export class Metadata {
  private readonly clickhouseClient: ClickhouseClient;
  private readonly cache: MetadataCache;

  constructor(clickhouseClient: ClickhouseClient, cache: MetadataCache) {
    this.clickhouseClient = clickhouseClient;
    this.cache = cache;
  }

  private async queryTableMetadata({
    tableConnection: { databaseName: database, tableName: table, connectionId },
    cache,
  }: {
    tableConnection: TableConnection;
    cache: MetadataCache;
  }) {
    return cache.getOrFetch(`${database}.${table}.metadata`, async () => {
      const sql = chSql`SELECT * FROM system.tables where database = ${{ String: database }} AND name = ${{ String: table }}`;
      const json = await this.clickhouseClient
        .query<'JSON'>({
          connectionId,
          query: sql.sql,
          query_params: sql.params,
        })
        .then(res => res.json<TableMetadata>());
      return json.data[0];
    });
  }

  async getColumns({ databaseName, tableName, connectionId }: TableConnection) {
    return this.cache.getOrFetch<ColumnMeta[]>(
      `${databaseName}.${tableName}.columns`,
      async () => {
        const sql = chSql`DESCRIBE ${tableExpr({ database: databaseName, table: tableName })}`;
        const columns = await this.clickhouseClient
          .query<'JSON'>({
            query: sql.sql,
            query_params: sql.params,
            connectionId,
          })
          .then(res => res.json())
          .then(d => d.data);
        return columns as ColumnMeta[];
      },
    );
  }

  async getMaterializedColumnsLookupTable(tableConnection: TableConnection) {
    const columns = await this.getColumns(tableConnection);

    // Build up materalized fields lookup table
    return new Map(
      columns
        .filter(
          c =>
            c.default_type === 'MATERIALIZED' || c.default_type === 'DEFAULT',
        )
        .map(c => [c.default_expression, c.name]),
    );
  }

  async getColumn({
    column,
    matchLowercase = false,
    tableConnection,
  }: {
    column: string;
    matchLowercase?: boolean;
    tableConnection: TableConnection;
  }): Promise<ColumnMeta | undefined> {
    const tableColumns = await this.getColumns(tableConnection);

    return tableColumns.filter(c => {
      if (matchLowercase) {
        return c.name.toLowerCase() === column.toLowerCase();
      }

      return c.name === column;
    })[0];
  }

  async getMapKeys({
    column,
    maxKeys = 1000,
    tableConnection,
  }: {
    column: string;
    maxKeys?: number;
    tableConnection: TableConnection;
  }) {
    const { databaseName, tableName, connectionId } = tableConnection;
    const cachedKeys = this.cache.get<string[]>(
      `${databaseName}.${tableName}.${column}.keys`,
    );

    if (cachedKeys != null) {
      return cachedKeys;
    }

    const colMeta = await this.getColumn({
      column,
      tableConnection,
    });

    if (colMeta == null) {
      throw new Error(
        `Column ${column} not found in ${databaseName}.${tableName}`,
      );
    }

    let strategy: 'groupUniqArrayArray' | 'lowCardinalityKeys' =
      'groupUniqArrayArray';
    if (colMeta.type.startsWith('Map(LowCardinality(String)')) {
      strategy = 'lowCardinalityKeys';
    }

    let sql: ChSql;
    if (strategy === 'groupUniqArrayArray') {
      sql = chSql`SELECT groupUniqArrayArray(${{ Int32: maxKeys }})(${{
        Identifier: column,
      }}) as keysArr
      FROM ${tableExpr({ database: databaseName, table: tableName })}`;
    } else {
      sql = chSql`SELECT DISTINCT lowCardinalityKeys(arrayJoin(${{
        Identifier: column,
      }}.keys)) as key
      FROM ${tableExpr({ database: databaseName, table: tableName })} 
      LIMIT ${{
        Int32: maxKeys,
      }}`;
    }

    return this.cache.getOrFetch<string[]>(
      `${databaseName}.${tableName}.${column}.keys`,
      async () => {
        const keys = await this.clickhouseClient
          .query<'JSON'>({
            query: sql.sql,
            query_params: sql.params,
            connectionId,
            clickhouse_settings: {
              max_rows_to_read: DEFAULT_SAMPLE_SIZE,
              read_overflow_mode: 'break',
            },
          })
          .then(res => res.json<Record<string, unknown>>())
          .then(d => {
            let output: string[];
            if (strategy === 'groupUniqArrayArray') {
              output = d.data[0].keysArr as string[];
            } else {
              output = d.data.map(row => row.key) as string[];
            }

            return output.filter(r => r);
          });
        return keys;
      },
    );
  }

  async getMapValues({
    column,
    key,
    maxValues = 20,
    tableConnection,
  }: {
    column: string;
    key?: string;
    maxValues?: number;
    tableConnection: TableConnection;
  }) {
    const { databaseName, tableName, connectionId } = tableConnection;
    const cachedValues = this.cache.get<string[]>(
      `${databaseName}.${tableName}.${column}.${key}.values`,
    );

    if (cachedValues != null) {
      return cachedValues;
    }

    const sql = key
      ? chSql`
      SELECT DISTINCT ${{
        Identifier: column,
      }}[${{ String: key }}] as value
      FROM ${tableExpr({ database: databaseName, table: tableName })}
      WHERE value != ''
      LIMIT ${{
        Int32: maxValues,
      }}
    `
      : chSql`
      SELECT DISTINCT ${{
        Identifier: column,
      }} as value
      FROM ${tableExpr({ database: databaseName, table: tableName })}
      WHERE value != ''
      LIMIT ${{
        Int32: maxValues,
      }}
    `;

    return this.cache.getOrFetch<string[]>(
      `${databaseName}.${tableName}.${column}.${key}.values`,
      async () => {
        const values = await this.clickhouseClient
          .query<'JSON'>({
            query: sql.sql,
            query_params: sql.params,
            connectionId,
            clickhouse_settings: {
              max_rows_to_read: DEFAULT_SAMPLE_SIZE,
              read_overflow_mode: 'break',
            },
          })
          .then(res => res.json<Record<string, unknown>>())
          .then(d => d.data.map(row => row.value as string));
        return values;
      },
    );
  }

  async getAllFields(tableConnection: TableConnection) {
    const fields: Field[] = [];
    const columns = await this.getColumns(tableConnection);

    for (const c of columns) {
      fields.push({
        path: [c.name],
        type: c.type,
        jsType: convertCHDataTypeToJSType(c.type),
      });
    }

    const mapColumns = filterColumnMetaByType(columns, [JSDataType.Map]) ?? [];

    await Promise.all(
      mapColumns.map(async column => {
        const keys = await this.getMapKeys({
          column: column.name,
          tableConnection,
        });

        const match = column.type.match(/Map\(.+,\s*(.+)\)/);
        const chType = match?.[1] ?? 'String'; // default to string ?

        for (const key of keys) {
          fields.push({
            path: [column.name, key],
            type: chType,
            jsType: convertCHDataTypeToJSType(chType),
          });
        }
      }),
    );

    return fields;
  }

  async getTableMetadata(tableConnection: TableConnection) {
    const tableMetadata = await this.queryTableMetadata({
      cache: this.cache,
      tableConnection,
    });

    // partition_key which includes parenthesis, unlike other keys such as 'primary_key' or 'sorting_key'
    if (
      tableMetadata.partition_key.startsWith('(') &&
      tableMetadata.partition_key.endsWith(')')
    ) {
      tableMetadata.partition_key = tableMetadata.partition_key.slice(1, -1);
    }
    return tableMetadata;
  }

  async getKeyValues({
    chartConfig,
    keys,
    limit = 20,
    disableRowLimit = false,
  }: {
    chartConfig: ChartConfigWithDateRange;
    keys: string[];
    limit?: number;
    disableRowLimit?: boolean;
  }) {
    const sql = await renderChartConfig(
      {
        ...chartConfig,
        select: keys
          .map((k, i) => `groupUniqArray(${limit})(${k}) AS param${i}`)
          .join(', '),
      },
      this,
    );

    const json = await this.clickhouseClient
      .query<'JSON'>({
        query: sql.sql,
        query_params: sql.params,
        connectionId: chartConfig.connection,
        clickhouse_settings: !disableRowLimit
          ? {
              max_rows_to_read: DEFAULT_SAMPLE_SIZE,
              read_overflow_mode: 'break',
            }
          : undefined,
      })
      .then(res => res.json<any>());

    return Object.entries(json.data[0]).map(([key, value]) => ({
      key: keys[parseInt(key.replace('param', ''))],
      value: (value as string[])?.filter(Boolean), // remove nulls
    }));
  }
}

export type Field = {
  path: string[];
  type: string;
  jsType: JSDataType | null;
};

export type TableConnection = {
  databaseName: string;
  tableName: string;
  connectionId: string;
};

export function tcFromChartConfig(config?: ChartConfig): TableConnection {
  return {
    databaseName: config?.from?.databaseName ?? '',
    tableName: config?.from?.tableName ?? '',
    connectionId: config?.connection ?? '',
  };
}

export function tcFromSource(source?: TSource): TableConnection {
  return {
    databaseName: source?.from?.databaseName ?? '',
    tableName: source?.from?.tableName ?? '',
    connectionId: source?.connection ?? '',
  };
}

const __LOCAL_CACHE__ = new MetadataCache();

// TODO: better to init the Metadata object on the client side
// also the client should be able to choose the cache strategy
export const getMetadata = (clickhouseClient: ClickhouseClient) =>
  new Metadata(clickhouseClient, __LOCAL_CACHE__);
