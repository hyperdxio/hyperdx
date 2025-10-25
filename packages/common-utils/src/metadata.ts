import type { ClickHouseSettings } from '@clickhouse/client-common';
import { omit, pick } from 'lodash';

import {
  BaseClickhouseClient,
  ChSql,
  chSql,
  ColumnMeta,
  convertCHDataTypeToJSType,
  filterColumnMetaByType,
  JSDataType,
  tableExpr,
} from '@/clickhouse';
import { renderChartConfig } from '@/renderChartConfig';
import type { ChartConfig, ChartConfigWithDateRange, TSource } from '@/types';

// If filters initially are taking too long to load, decrease this number.
// Between 1e6 - 5e6 is a good range.
export const DEFAULT_METADATA_MAX_ROWS_TO_READ = 3e6;
const DEFAULT_MAX_KEYS = 1000;

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
  private readonly clickhouseClient: BaseClickhouseClient;
  private readonly cache: MetadataCache;

  constructor(
    clickhouseClient: BaseClickhouseClient,
    cache: MetadataCache,
    settings?: ClickHouseSettings,
  ) {
    this.clickhouseClient = clickhouseClient;
    this.cache = cache;
    if (settings) {
      this.cache.set('clickhouse-settings', settings);
    }
  }

  getClickHouseSettings(): ClickHouseSettings {
    return this.cache.get<ClickHouseSettings>('clickhouse-settings') ?? {};
  }

  setClickHouseSettings(settings: ClickHouseSettings) {
    const currentSettings = this.getClickHouseSettings();
    const updatedSettings = { ...currentSettings, ...settings };
    this.cache.set('clickhouse-settings', updatedSettings);
  }

  private async queryTableMetadata({
    database,
    table,
    cache,
    connectionId,
  }: {
    database: string;
    table: string;
    cache: MetadataCache;
    connectionId: string;
  }) {
    return cache.getOrFetch(
      `${connectionId}.${database}.${table}.metadata`,
      async () => {
        const sql = chSql`SELECT * FROM system.tables where database = ${{ String: database }} AND name = ${{ String: table }}`;
        const json = await this.clickhouseClient
          .query<'JSON'>({
            connectionId,
            query: sql.sql,
            query_params: sql.params,
            clickhouse_settings: this.getClickHouseSettings(),
          })
          .then(res => res.json<TableMetadata>());
        return json.data[0];
      },
    );
  }

  async getColumns({
    databaseName,
    tableName,
    connectionId,
  }: {
    databaseName: string;
    tableName: string;
    connectionId: string;
  }) {
    return this.cache.getOrFetch<ColumnMeta[]>(
      `${connectionId}.${databaseName}.${tableName}.columns`,
      async () => {
        const sql = chSql`DESCRIBE ${tableExpr({ database: databaseName, table: tableName })}`;
        const columns = await this.clickhouseClient
          .query<'JSON'>({
            query: sql.sql,
            query_params: sql.params,
            connectionId,
            clickhouse_settings: this.getClickHouseSettings(),
          })
          .then(res => res.json())
          .then(d => d.data);
        return columns as ColumnMeta[];
      },
    );
  }

  async getMaterializedColumnsLookupTable({
    databaseName,
    tableName,
    connectionId,
  }: {
    databaseName: string;
    tableName: string;
    connectionId: string;
  }) {
    const columns = await this.getColumns({
      databaseName,
      tableName,
      connectionId,
    });

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
    databaseName,
    tableName,
    column,
    matchLowercase = false,
    connectionId,
  }: {
    databaseName: string;
    tableName: string;
    column: string;
    matchLowercase?: boolean;
    connectionId: string;
  }): Promise<ColumnMeta | undefined> {
    const tableColumns = await this.getColumns({
      databaseName,
      tableName,
      connectionId,
    });

    return tableColumns.filter(c => {
      if (matchLowercase) {
        return c.name.toLowerCase() === column.toLowerCase();
      }

      return c.name === column;
    })[0];
  }

  async getMapKeys({
    databaseName,
    tableName,
    column,
    maxKeys = DEFAULT_MAX_KEYS,
    connectionId,
    metricName,
  }: {
    databaseName: string;
    tableName: string;
    column: string;
    maxKeys?: number;
    connectionId: string;
    metricName?: string;
  }) {
    const cacheKey = metricName
      ? `${connectionId}.${databaseName}.${tableName}.${column}.${metricName}.keys`
      : `${connectionId}.${databaseName}.${tableName}.${column}.keys`;
    const cachedKeys = this.cache.get<string[]>(cacheKey);

    if (cachedKeys != null) {
      return cachedKeys;
    }

    const colMeta = await this.getColumn({
      databaseName,
      tableName,
      column,
      connectionId,
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

    const where = metricName
      ? chSql`WHERE MetricName=${{ String: metricName }}`
      : '';
    let sql: ChSql;
    if (strategy === 'groupUniqArrayArray') {
      sql = chSql`
        WITH sampledKeys as (
          SELECT ${{
            Identifier: column,
          }}.keys AS keys
          FROM ${tableExpr({ database: databaseName, table: tableName })} ${where}
          LIMIT ${{
            Int32: this.getClickHouseSettings().max_rows_to_read
              ? Number(this.getClickHouseSettings().max_rows_to_read)
              : DEFAULT_METADATA_MAX_ROWS_TO_READ,
          }}
        )
        SELECT groupUniqArrayArray(${{ Int32: maxKeys }})(keys) as keysArr
        FROM sampledKeys`;
    } else {
      sql = chSql`
        WITH sampledKeys as (
          SELECT ${{
            Identifier: column,
          }}.keys AS keysArr
          FROM ${tableExpr({ database: databaseName, table: tableName })} ${where}
          LIMIT ${{
            Int32: this.getClickHouseSettings().max_rows_to_read
              ? Number(this.getClickHouseSettings().max_rows_to_read)
              : DEFAULT_METADATA_MAX_ROWS_TO_READ,
          }}
        )
        SELECT DISTINCT lowCardinalityKeys(arrayJoin(keysArr)) as key
        FROM sampledKeys
        LIMIT ${{
          Int32: maxKeys,
        }}
      `;
    }

    return this.cache.getOrFetch<string[]>(cacheKey, async () => {
      const keys = await this.clickhouseClient
        .query<'JSON'>({
          query: sql.sql,
          query_params: sql.params,
          connectionId,
          clickhouse_settings: {
            ...this.getClickHouseSettings(),
            // Max 15 seconds to get keys
            timeout_overflow_mode: 'break',
            max_execution_time: 15,
            // Set the value to 0 (unlimited) so that the LIMIT is used instead
            max_rows_to_read: '0',
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
    });
  }

  async getJSONKeys({
    column,
    maxKeys = DEFAULT_MAX_KEYS,
    databaseName,
    tableName,
    connectionId,
    metricName,
  }: {
    column: string;
    maxKeys?: number;
  } & TableConnection) {
    // HDX-2480 delete line below to reenable json filters
    return []; // Need to disable JSON keys for the time being.
    const cacheKey = metricName
      ? `${connectionId}.${databaseName}.${tableName}.${column}.${metricName}.keys`
      : `${connectionId}.${databaseName}.${tableName}.${column}.keys`;

    return this.cache.getOrFetch<{ key: string; chType: string }[]>(
      cacheKey,
      async () => {
        const where = metricName
          ? chSql`WHERE MetricName=${{ String: metricName }}`
          : '';
        const sql = chSql`WITH all_paths AS
        (
            SELECT DISTINCT JSONDynamicPathsWithTypes(${{ Identifier: column }}) as paths
            FROM ${tableExpr({ database: databaseName, table: tableName })} ${where}
            LIMIT ${{ Int32: maxKeys }}
            SETTINGS timeout_overflow_mode = 'break', max_execution_time = 2
        )
        SELECT groupUniqArrayMap(paths) as pathMap
        FROM all_paths;`;

        const keys = await this.clickhouseClient
          .query<'JSON'>({
            query: sql.sql,
            query_params: sql.params,
            connectionId,
            clickhouse_settings: {
              max_rows_to_read: String(
                this.getClickHouseSettings().max_rows_to_read ??
                  DEFAULT_METADATA_MAX_ROWS_TO_READ,
              ),
              read_overflow_mode: 'break',
              ...this.getClickHouseSettings(),
            },
          })
          .then(res => res.json<{ pathMap: Record<string, string[]> }>())
          .then(d => {
            const keys: { key: string; chType: string }[] = [];
            for (const [key, typeArr] of Object.entries(d.data[0].pathMap)) {
              if (!key || !typeArr || !Array.isArray(typeArr)) {
                throw new Error(
                  `Error fetching keys for filters (key: ${key}, typeArr: ${typeArr})`,
                );
              }
              keys.push({
                key: key,
                chType: typeArr[0],
              });
            }
            return keys;
          });
        return keys;
      },
    );
  }

  async getMapValues({
    databaseName,
    tableName,
    column,
    key,
    maxValues = 20,
    connectionId,
  }: {
    databaseName: string;
    tableName: string;
    column: string;
    key?: string;
    maxValues?: number;
    connectionId: string;
  }) {
    const cacheKey = `${connectionId}.${databaseName}.${tableName}.${column}.${key}.values`;

    const cachedValues = this.cache.get<string[]>(cacheKey);

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

    return this.cache.getOrFetch<string[]>(cacheKey, async () => {
      const values = await this.clickhouseClient
        .query<'JSON'>({
          query: sql.sql,
          query_params: sql.params,
          connectionId,
          clickhouse_settings: {
            max_rows_to_read: String(
              this.getClickHouseSettings().max_rows_to_read ??
                DEFAULT_METADATA_MAX_ROWS_TO_READ,
            ),
            read_overflow_mode: 'break',
            ...this.getClickHouseSettings(),
          },
        })
        .then(res => res.json<Record<string, unknown>>())
        .then(d => d.data.map(row => row.value as string));
      return values;
    });
  }

  async getAllFields({
    databaseName,
    tableName,
    connectionId,
    metricName,
  }: TableConnection) {
    const fields: Field[] = [];
    const columns = await this.getColumns({
      databaseName,
      tableName,
      connectionId,
    });

    for (const c of columns) {
      // HDX-2480 delete condition below to reenable json filters
      if (c.type === 'JSON') continue;
      fields.push({
        path: [c.name],
        type: c.type,
        jsType: convertCHDataTypeToJSType(c.type),
      });
    }

    const mapColumns =
      filterColumnMetaByType(columns, [JSDataType.Map, JSDataType.JSON]) ?? [];

    await Promise.all(
      mapColumns.map(async column => {
        if (convertCHDataTypeToJSType(column.type) === JSDataType.JSON) {
          const paths = await this.getJSONKeys({
            databaseName,
            tableName,
            column: column.name,
            connectionId,
            metricName,
          });

          for (const path of paths) {
            fields.push({
              path: [column.name, path.key],
              type: path.chType,
              jsType: convertCHDataTypeToJSType(path.chType),
            });
          }
          return;
        }

        const keys = await this.getMapKeys({
          databaseName,
          tableName,
          column: column.name,
          connectionId,
          metricName,
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

  async getTableMetadata({
    databaseName,
    tableName,
    connectionId,
  }: {
    databaseName: string;
    tableName: string;
    connectionId: string;
  }) {
    const tableMetadata = await this.queryTableMetadata({
      cache: this.cache,
      database: databaseName,
      table: tableName,
      connectionId,
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

  async getValuesDistribution({
    chartConfig,
    key,
    samples = 100_000,
    limit = 100,
  }: {
    chartConfig: ChartConfigWithDateRange;
    key: string;
    samples?: number;
    limit?: number;
  }) {
    const cacheKeyConfig = pick(chartConfig, [
      'connection',
      'from',
      'dateRange',
      'filters',
      'where',
      'with',
    ]);
    return this.cache.getOrFetch(
      `${JSON.stringify(cacheKeyConfig)}.${key}.valuesDistribution`,
      async () => {
        const config: ChartConfigWithDateRange = {
          ...chartConfig,
          with: [
            ...(chartConfig.with || []),
            // Add CTE to get total row count and sample factor
            {
              name: 'tableStats',
              chartConfig: {
                ...omit(chartConfig, ['with', 'groupBy', 'orderBy', 'limit']),
                select: `count() as total, greatest(CAST(total / ${samples} AS UInt32), 1) as sample_factor`,
              },
            },
          ],
          // Add sampling condition as a filter. The query will still read all rows to evaluate
          // the sampling condition, but will only read values column from selected rows.
          filters: [
            ...(chartConfig.filters || []),
            {
              type: 'sql',
              condition: `cityHash64(${chartConfig.timestampValueExpression}, rand()) % (SELECT sample_factor FROM tableStats) = 0`,
            },
          ],
          select: `${key} AS __hdx_value, count() as __hdx_count, __hdx_count / (sum(__hdx_count) OVER ()) * 100 AS __hdx_percentage`,
          orderBy: '__hdx_percentage DESC',
          groupBy: `__hdx_value`,
          limit: { limit },
        };

        const sql = await renderChartConfig(config, this);

        const json = await this.clickhouseClient
          .query<'JSON'>({
            query: sql.sql,
            query_params: sql.params,
            connectionId: chartConfig.connection,
            clickhouse_settings: {
              ...this.getClickHouseSettings(),
              // Set max_rows_to_group_by to avoid using too much memory when grouping on high cardinality key columns
              max_rows_to_group_by: `${limit * 10}`,
              group_by_overflow_mode: 'any',
              // disable max_rows_to_read limit since this is a sampled query that only happens after the user toggles it on
              max_rows_to_read: '0',
            },
          })
          .then(res =>
            res.json<{
              __hdx_value: string;
              __hdx_percentage: string | number;
            }>(),
          );

        return new Map(
          json.data.map(({ __hdx_value, __hdx_percentage }) => [
            __hdx_value,
            Number(__hdx_percentage),
          ]),
        );
      },
    );
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
    return this.cache.getOrFetch(
      `${chartConfig.connection}.${chartConfig.from.databaseName}.${chartConfig.from.tableName}.${keys.join(',')}.${chartConfig.dateRange.toString()}.${disableRowLimit}.values`,
      async () => {
        if (keys.length === 0) return [];

        // When disableRowLimit is true, query directly without CTE
        // Otherwise, use CTE with row limits for sampling
        const sqlConfig = disableRowLimit
          ? {
              ...chartConfig,
              select: keys
                .map((k, i) => `groupUniqArray(${limit})(${k}) AS param${i}`)
                .join(', '),
            }
          : await (async () => {
              // Build select expression that includes all columns by name
              // This ensures materialized columns are included
              const selectExpr =
                keys.map((k, i) => `${k} as param${i}`).join(', ') || '*';

              return {
                with: [
                  {
                    name: 'sampledData',
                    chartConfig: {
                      ...chartConfig,
                      select: selectExpr,
                      limit: {
                        limit: this.getClickHouseSettings().max_rows_to_read
                          ? Number(
                              this.getClickHouseSettings().max_rows_to_read,
                            )
                          : DEFAULT_METADATA_MAX_ROWS_TO_READ,
                      },
                    },
                    isSubquery: true,
                  },
                ],
                select: keys
                  .map(
                    (_, i) =>
                      `groupUniqArray(${limit})(param${i}) AS param${i}`,
                  )
                  .join(', '),
                connection: chartConfig.connection,
                from: { databaseName: '', tableName: 'sampledData' },
                where: '',
              };
            })();

        const sql = await renderChartConfig(sqlConfig, this);

        const json = await this.clickhouseClient
          .query<'JSON'>({
            query: sql.sql,
            query_params: sql.params,
            connectionId: chartConfig.connection,
            clickhouse_settings: !disableRowLimit
              ? {
                  ...this.getClickHouseSettings(),
                  // Max 15 seconds to get keys
                  timeout_overflow_mode: 'break',
                  max_execution_time: 15,
                  // Set the value to 0 (unlimited) so that the LIMIT is used instead
                  max_rows_to_read: '0',
                }
              : undefined,
          })
          .then(res => res.json<any>());

        // TODO: Fix type issues mentioned in HDX-1548. value is not acually a
        // string[], sometimes it's { [key: string]: string; }
        return Object.entries(json?.data?.[0]).map(([key, value]) => ({
          key: keys[parseInt(key.replace('param', ''))],
          value: (value as string[])?.filter(Boolean), // remove nulls
        }));
      },
    );
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
  metricName?: string;
};

export type TableConnectionChoice =
  | {
      tableConnection?: never;
      tableConnections?: TableConnection[];
    }
  | {
      tableConnection?: TableConnection;
      tableConnections?: never;
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
export const getMetadata = (clickhouseClient: BaseClickhouseClient) =>
  new Metadata(clickhouseClient, __LOCAL_CACHE__);
