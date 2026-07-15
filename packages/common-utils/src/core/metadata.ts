import type { ClickHouseSettings } from '@clickhouse/client-common';
import { chunk, omit, pick } from 'lodash';

import {
  BaseClickhouseClient,
  ChSql,
  chSql,
  ColumnMeta,
  concatChSql,
  convertCHDataTypeToJSType,
  filterColumnMetaByType,
  JSDataType,
  tableExpr,
} from '@/clickhouse';
import { renderChartConfig, timeFilterExpr } from '@/core/renderChartConfig';
import {
  buildTextIndexInfoLookup,
  KvIndexInfo,
  skipIndexMatches,
  TextIndexInfo,
  TextIndexInfoLookup,
} from '@/queryParser';
import type {
  BuilderChartConfig,
  BuilderChartConfigWithDateRange,
  MetadataMaterializedViews,
  TSource,
} from '@/types';
import { isLogSource, isTraceSource, SourceKind } from '@/types';

import { ClickHouseVersion, parseClickHouseVersion } from './clickhouseVersion';
import {
  optimizeGetKeyValuesCalls,
  renderStartOfBucketExpr,
} from './materializedViews';
import {
  getAlignedDateRange,
  getDistributedTableArgs,
  MetadataMVQueryOptions,
  objectHash,
  TextIndexColumnQueryOptions,
  TextIndexMapColumnQueryOptions,
} from './utils';

// If filters initially are taking too long to load, decrease this number.
// Between 1e6 - 5e6 is a good range.
export const DEFAULT_METADATA_MAX_ROWS_TO_READ = 3e6;
const DEFAULT_MAX_KEYS = 1000;

// Cap keys per dispatched query: each key becomes one or more URL-encoded
// query_params on the ClickHouse HTTP call, and a few dozen is enough to
// exceed proxy header limits (HTTP 431). Recursive chunks reuse the cached
// strategy lookup, so the only cost is extra parallel HTTP calls.
const GET_ALL_KEY_VALUES_CHUNK_SIZE = 40;

type KeyFetchingStrategies = {
  mapTextIndexLookup: TextIndexInfo[];
  nativeTextIndexLookup: SkipIndexMetadata[];
  metadataMVs: { columnName: string; mvName: string }[];
  rawTable: string[];
};

export type KeyValues = {
  key: string;
  value: string[] | number[];
};

// See https://github.com/hyperdxio/hyperdx/issues/2163. Inlining a validated
// integer literal avoids the `_CAST` wrapper entirely.
const inlineNonNegativeInt = (value: number, label: string): string => {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(
      `${label} must be a non-negative integer, got: ${String(value)}`,
    );
  }
  return String(value);
};

const unquoteIdentifier = (identifier: string): string => {
  if (
    (identifier.startsWith('`') && identifier.endsWith('`')) ||
    (identifier.startsWith('"') && identifier.endsWith('"'))
  ) {
    return identifier.slice(1, -1);
  }
  return identifier;
};

const quoteJsonPathSegment = (segment: string): string => {
  const unquoted = unquoteIdentifier(segment);
  return `\`${unquoted.replace(/`/g, '``')}\``;
};

const quoteIdentifierIfNeeded = (identifier: string): string => {
  const unquoted = unquoteIdentifier(identifier);
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(unquoted)
    ? unquoted
    : quoteJsonPathSegment(unquoted);
};

const JSON_STRING_TYPE_SUFFIX = '.:String';

const renderJsonStringSubcolumn = (
  column: string,
  jsonPath: string,
  options: { preserveStringTypeSuffix?: boolean } = {},
): string => {
  const columnIdentifier = quoteIdentifierIfNeeded(column);
  const untypedJsonPath =
    options.preserveStringTypeSuffix &&
    jsonPath.endsWith(JSON_STRING_TYPE_SUFFIX)
      ? jsonPath.slice(0, -JSON_STRING_TYPE_SUFFIX.length)
      : jsonPath;

  const path = untypedJsonPath
    .split('.')
    .filter(Boolean)
    .map(quoteJsonPathSegment)
    .join('.');

  return `${columnIdentifier}.${path}${JSON_STRING_TYPE_SUFFIX}`;
};

export class MetadataCache {
  private cache = new Map<string, any>();
  private pendingQueries = new Map<string, Promise<any>>();

  // this should be getOrUpdate... or just query to follow react query
  get<T>(key: string): T | undefined {
    return this.cache.get(key);
  }

  async getOrFetch<T>(key: string, query: () => Promise<T>): Promise<T> {
    // Check if value exists in cache
    const cachedValue: T | undefined = this.cache.get(key);
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

export type MapColumnTextIndexes = {
  keysIndex?: { indexName: string };
  itemsIndex?: { indexName: string; separator: string };
};

export type TableMetadata = {
  database: string;
  name: string;
  uuid: string;
  /** Note: This will contain the engine of the local table, when the table is Distributed */
  engine: string;
  is_temporary: number;
  data_paths: string[];
  metadata_path: string;
  metadata_modification_time: string;
  metadata_version: number;
  /** Note: This may be a Distributed table. Use create_local_table_query for the local table's DDL. */
  create_table_query: string;
  /** DDL for the local (non-distributed) table, when the table is Distributed */
  create_local_table_query?: string;
  /**
   * True when the queried table routes to other tables rather than holding its
   * own data — i.e. a Distributed or Merge table (whose underlying target
   * tables may declare differing column sets).
   **/
  isPointerTable?: boolean;
  /** Note: This will contain the engine_full of the local table, when the table is Distributed */
  engine_full: string;
  as_select: string;
  /** Note: This will contain the partition_key of the local table, when the table is Distributed */
  partition_key: string;
  /** Note: This will contain the sorting_key of the local table, when the table is Distributed */
  sorting_key: string;
  /** Note: This will contain the primary_key of the local table, when the table is Distributed */
  primary_key: string;
  /** Note: This will contain the sampling_key of the local table, when the table is Distributed */
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

export type SkipIndexMetadata = {
  name: string;
  type: string; // 'bloom_filter', 'tokenbf_v1', 'minmax', etc.
  typeFull: string; // e.g., 'text(tokenizer='splitByNonAlpha')'
  expression: string; // e.g., "tokens(lower(Body))"
  granularity: number;
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

  private async renderMetadataKeyExpression({
    databaseName,
    tableName,
    connectionId,
    keyExpression,
  }: {
    databaseName: string;
    tableName: string;
    connectionId: string;
    keyExpression: string;
  }): Promise<string> {
    const directColumn = await this.getColumn({
      databaseName,
      tableName,
      column: unquoteIdentifier(keyExpression),
      connectionId,
    });
    if (directColumn != null) {
      return quoteIdentifierIfNeeded(keyExpression);
    }

    const bracketPath = parseKeyPath(keyExpression);
    if (bracketPath.length >= 2) {
      const column = unquoteIdentifier(bracketPath[0]);
      const columnMeta = await this.getColumn({
        databaseName,
        tableName,
        column,
        connectionId,
      });

      if (
        convertCHDataTypeToJSType(columnMeta?.type ?? '') === JSDataType.JSON
      ) {
        return renderJsonStringSubcolumn(column, bracketPath[1]);
      }

      return keyExpression;
    }

    const dotIdx = keyExpression.indexOf('.');
    if (dotIdx === -1 || keyExpression.includes('(')) {
      return keyExpression;
    }

    const column = unquoteIdentifier(keyExpression.slice(0, dotIdx));
    const jsonPath = keyExpression.slice(dotIdx + 1);
    const columnMeta = await this.getColumn({
      databaseName,
      tableName,
      column,
      connectionId,
    });

    if (convertCHDataTypeToJSType(columnMeta?.type ?? '') === JSDataType.JSON) {
      return renderJsonStringSubcolumn(column, jsonPath, {
        preserveStringTypeSuffix: true,
      });
    }

    return keyExpression;
  }

  private async queryTableMetadata({
    database,
    table,
    cache,
    connectionId,
    cluster,
  }: {
    database: string;
    table: string;
    cache: MetadataCache;
    connectionId: string;
    cluster?: string;
  }): Promise<TableMetadata | undefined> {
    const cacheKey = `${connectionId}.${database}.${table}.${cluster}.metadata`;
    return cache.getOrFetch(cacheKey, async () => {
      const sql = cluster
        ? chSql`SELECT * FROM cluster(${{ String: cluster }}, system.tables) WHERE database = ${{ String: database }} AND name = ${{ String: table }} LIMIT 1`
        : chSql`SELECT * FROM system.tables WHERE database = ${{ String: database }} AND name = ${{ String: table }} LIMIT 1`;
      const json = await this.clickhouseClient
        .query<'JSON'>({
          connectionId,
          query: sql.sql,
          query_params: sql.params,
          clickhouse_settings: this.getClickHouseSettings(),
        })
        .then(res => res.json<TableMetadata>());
      return json.data[0];
    });
  }

  private async querySkipIndices({
    database,
    table,
    connectionId,
    cluster,
  }: {
    database: string;
    table: string;
    connectionId: string;
    cluster?: string;
  }): Promise<SkipIndexMetadata[]> {
    const sql = cluster
      ? chSql`
        SELECT 
          name,
          type,
          type_full as typeFull,
          expr as expression,
          granularity
        FROM cluster(${{ String: cluster }}, system.data_skipping_indices)
        WHERE database = ${{ String: database }} AND table = ${{ String: table }}`
      : chSql`
        SELECT
          name,
          type,
          type_full as typeFull,
          expr as expression,
          granularity
        FROM system.data_skipping_indices
        WHERE database = ${{ String: database }} AND table = ${{ String: table }}`;

    const data = await this.clickhouseClient
      .query<'JSON'>({
        connectionId,
        query: sql.sql,
        query_params: sql.params,
        clickhouse_settings: this.getClickHouseSettings(),
      })
      .then(res => res.json<SkipIndexMetadata>())
      .then(d => {
        return d.data.map(row => ({
          ...row,
          granularity: Number(row.granularity),
        }));
      });

    return data;
  }

  /** Queries and returns the list of materialized views which insert into the given target table */
  async queryMaterializedViewsByTarget({
    databaseName,
    tableName,
    connectionId,
  }: TableConnection) {
    return this.cache.getOrFetch(
      `${connectionId}.${databaseName}.${tableName}.sourceMaterializedViews`,
      async () => {
        const toDatabaseTable = `%TO ${databaseName}.${tableName}%`;
        const sql = chSql`
          SELECT database as databaseName, name as tableName
          FROM system.tables
          WHERE engine = 'MaterializedView' 
            AND create_table_query LIKE ${{ String: toDatabaseTable }}`;
        const json = await this.clickhouseClient
          .query<'JSON'>({
            connectionId,
            query: sql.sql,
            query_params: sql.params,
            clickhouse_settings: this.getClickHouseSettings(),
          })
          .then(res => res.json<{ databaseName: string; tableName: string }>());
        return json.data;
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
          .then(res => res.json<ColumnMeta>())
          .then(d => d.data);
        return columns;
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

    // Build up materialized fields lookup table
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

  async getMapColumnTextIndexes({
    databaseName,
    tableName,
    connectionId,
  }: TableConnection) {
    return this.cache.getOrFetch(
      `${connectionId}.${databaseName}.${tableName}.mapColumnTextIndexes`,
      async () => {
        return buildTextIndexInfoLookup({
          metadata: this,
          databaseName: databaseName,
          tableName: tableName,
          connectionId: connectionId,
        });
      },
    );
  }

  async getNativeArrayColumnTextIndexes({
    databaseName,
    tableName,
    connectionId,
  }: TableConnection): Promise<Map<string, SkipIndexMetadata>> {
    return this.cache.getOrFetch(
      `${connectionId}.${databaseName}.${tableName}.nativeColumnTextIndexes`,
      async () => {
        const [columns, skipIndices] = await Promise.all([
          this.getColumns({ databaseName, tableName, connectionId }),
          this.getSkipIndices({
            databaseName,
            tableName,
            connectionId,
          }).catch(() => [] as SkipIndexMetadata[]),
        ]);

        /** Map from map column name to its text index info */
        const indices: Map<string, SkipIndexMetadata> = new Map();
        for (const idx of skipIndices) {
          if (
            skipIndexMatches(idx, 'text', { tokenizer: 'array' }) &&
            columns.some(col => col.name === idx.expression)
          ) {
            indices.set(idx.expression, idx);
          }
        }
        return indices;
      },
    );
  }

  private async partsOverlapFilter({
    databaseName,
    tableName,
    dateRange,
    timestampValueExpression,
  }: {
    databaseName: string;
    tableName: string;
    dateRange?: [Date, Date];
    timestampValueExpression?: string;
  }): Promise<ChSql> {
    if (!dateRange || !timestampValueExpression) return chSql`1`;
    const startTime = chSql`fromUnixTimestamp64Milli(${{ Int64: dateRange[0].getTime() }})`;
    const endTime = chSql`fromUnixTimestamp64Milli(${{ Int64: dateRange[1].getTime() }})`;
    return chSql`part_name IN (
      SELECT name
      FROM system.parts
      WHERE database = ${{ String: databaseName }} AND table = ${{ String: tableName }}
        AND active=1
        AND ((min_time >= ${startTime} AND min_time <= ${endTime}) OR (max_time <= ${endTime} AND max_time >= ${startTime}) OR (min_time <= ${startTime} AND max_time >= ${endTime}))
    )`;
  }

  async getMapKeys({
    databaseName,
    tableName,
    column,
    maxKeys = DEFAULT_MAX_KEYS,
    connectionId,
    metricName,
    metadataMVs,
    dateRange,
    timestampValueExpression,
    signal,
  }: {
    databaseName: string;
    tableName: string;
    column: string;
    maxKeys?: number;
    connectionId: string;
    metricName?: string;
    metadataMVs?: MetadataMaterializedViews;
    dateRange?: [Date, Date];
    timestampValueExpression?: string;
    signal?: AbortSignal;
  }) {
    inlineNonNegativeInt(maxKeys, 'maxKeys');

    // Align date range to rollup granularity for consistent cache keys
    const alignedDateRange =
      metadataMVs && dateRange
        ? getAlignedDateRange(dateRange, metadataMVs.granularity)
        : undefined;

    const dateRangeCacheSuffix =
      dateRange && timestampValueExpression
        ? `${dateRange[0].getTime()}-${dateRange[1].getTime()}-${timestampValueExpression}`
        : '';
    const cacheKey = metricName
      ? `${connectionId}.${databaseName}.${tableName}.${column}.${metricName}.${dateRangeCacheSuffix}.keys`
      : metadataMVs && alignedDateRange
        ? `${connectionId}.${databaseName}.${tableName}.${column}.${alignedDateRange[0].getTime()}.${alignedDateRange[1].getTime()}.keys`
        : `${connectionId}.${databaseName}.${tableName}.${column}.${dateRangeCacheSuffix}.keys`;
    const cachedKeys = this.cache.get<string[]>(cacheKey);

    if (cachedKeys != null) {
      return cachedKeys;
    }

    const textIndexInfoLookup = await this.getMapColumnTextIndexes({
      databaseName,
      tableName,
      connectionId,
    });

    // Text Index path: query the key rollup index
    const textIndexInfo = textIndexInfoLookup.get(column);
    if (textIndexInfo?.key?.indexName) {
      const partsFilter = await this.partsOverlapFilter({
        databaseName,
        tableName,
        dateRange,
        timestampValueExpression,
      });
      const index = textIndexInfo.key.indexName;
      const sql = chSql`
        SELECT token AS key
        FROM mergeTreeTextIndex(${{ String: databaseName }}, ${{ String: tableName }}, ${{ String: index }})
        WHERE ${partsFilter}
        GROUP BY key HAVING key != ''
        LIMIT ${{ Int32: maxKeys }}`;
      const keys = await this.clickhouseClient
        .query<'JSON'>({
          query: sql.sql,
          query_params: sql.params,
          connectionId,
          clickhouse_settings: this.getClickHouseSettings(),
        })
        .then(r => r.json<{ key: string }>())
        .then(d => d.data.map(r => r.key).filter(Boolean));
      if (keys.length > 0) {
        this.cache.set(cacheKey, keys);
        return keys;
      }
    } else if (textIndexInfo?.kv?.indexName) {
      const partsFilter = await this.partsOverlapFilter({
        databaseName,
        tableName,
        dateRange,
        timestampValueExpression,
      });
      const index = textIndexInfo.kv.indexName;
      const separator = textIndexInfo.kv.separator;
      const sql = chSql`
        SELECT splitByString(${{ String: separator }}, token)[1] AS key
        FROM mergeTreeTextIndex(${{ String: databaseName }}, ${{ String: tableName }}, ${{ String: index }})
        WHERE ${partsFilter}
        GROUP BY key HAVING key != ''
        LIMIT ${{ Int32: maxKeys }}`;
      const keys = await this.clickhouseClient
        .query<'JSON'>({
          query: sql.sql,
          query_params: sql.params,
          connectionId,
          clickhouse_settings: this.getClickHouseSettings(),
        })
        .then(r => r.json<{ key: string }>())
        .then(d => d.data.map(r => r.key).filter(Boolean));
      if (keys.length > 0) {
        this.cache.set(cacheKey, keys);
        return keys;
      }
    }

    // Rollup path: query the key rollup table filtered by ColumnIdentifier and date range
    if (metadataMVs && alignedDateRange) {
      const rollupKeys = await this.cache.getOrFetch<string[]>(
        cacheKey,
        async () => {
          try {
            const startExpr = renderStartOfBucketExpr(
              metadataMVs.granularity,
              chSql`fromUnixTimestamp64Milli(${{ Int64: alignedDateRange[0].getTime() }})`,
            );
            const endExpr = renderStartOfBucketExpr(
              metadataMVs.granularity,
              chSql`fromUnixTimestamp64Milli(${{ Int64: alignedDateRange[1].getTime() }})`,
            );
            const timeFilter = chSql`AND Timestamp >= ${startExpr} AND Timestamp <= ${endExpr}`;
            let sql: ChSql;
            if (metadataMVs.keyRollupTable) {
              sql = chSql`
                SELECT Key
                FROM ${tableExpr({ database: databaseName, table: metadataMVs.keyRollupTable })}
                WHERE ColumnIdentifier = ${{ String: column }}
                  ${timeFilter}
                GROUP BY Key
                ORDER BY sum(count) DESC
                LIMIT ${{ Int32: maxKeys }}
              `;
            } else {
              sql = chSql`
                SELECT Key
                FROM ${tableExpr({ database: databaseName, table: metadataMVs.kvRollupTable })}
                WHERE ColumnIdentifier = ${{ String: column }}
                  ${timeFilter}
                GROUP BY Key
                ORDER BY sum(count) DESC
                LIMIT ${{ Int32: maxKeys }}
              `;
            }

            return await this.clickhouseClient
              .query<'JSON'>({
                query: sql.sql,
                query_params: sql.params,
                connectionId,
                clickhouse_settings: {
                  ...this.getClickHouseSettings(),
                  timeout_overflow_mode: 'break',
                  max_execution_time: 15,
                  max_rows_to_read: '0',
                },
                abort_signal: signal,
              })
              .then(res => res.json<{ Key: string }>())
              .then(d => d.data.map(row => row.Key).filter(k => k));
          } catch (e) {
            console.warn('getMapKeys rollup query failed', e);
            return [];
          }
        },
      );

      if (rollupKeys.length > 0) return rollupKeys;
    }

    // Original path: scan main table
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

    const timeFilterCondition =
      dateRange && timestampValueExpression
        ? await timeFilterExpr({
            connectionId,
            databaseName,
            tableName,
            dateRange,
            dateRangeStartInclusive: true,
            dateRangeEndInclusive: true,
            timestampValueExpression,
            metadata: this,
          })
        : null;
    const whereConditions: ChSql[] = [
      ...(metricName ? [chSql`MetricName=${{ String: metricName }}`] : []),
      ...(timeFilterCondition ? [timeFilterCondition] : []),
    ];
    const where = whereConditions.length
      ? chSql`WHERE ${concatChSql(' AND ', ...whereConditions)}`
      : '';

    // NOTE: getSubcolumn(col, 'keys') is used instead of the `col.keys` dot
    // form because, on a multi-shard Distributed read of a Map subcolumn, some
    // ClickHouse builds name that plan column inconsistently across the
    // distributed hop (one side `col.keys`, the other `getSubcolumn(col,'keys')`),
    // failing with THERE_IS_NO_COLUMN / NOT_FOUND_COLUMN_IN_BLOCK. The explicit
    // function form serializes to a single consistent name and avoids it.
    let sql: ChSql;
    if (strategy === 'groupUniqArrayArray') {
      sql = chSql`
        WITH sampledKeys as (
          SELECT getSubcolumn(${{
            Identifier: column,
          }}, 'keys') AS keys
          FROM ${tableExpr({ database: databaseName, table: tableName })} ${where}
          LIMIT ${{
            Int32: this.getClickHouseSettings().max_rows_to_read
              ? Number(this.getClickHouseSettings().max_rows_to_read)
              : DEFAULT_METADATA_MAX_ROWS_TO_READ,
          }}
        )
        SELECT groupUniqArrayArray(${{ UNSAFE_RAW_SQL: inlineNonNegativeInt(maxKeys, 'maxKeys') }})(keys) as keysArr
        FROM sampledKeys`;
    } else {
      sql = chSql`
        WITH sampledKeys as (
          SELECT getSubcolumn(${{
            Identifier: column,
          }}, 'keys') AS keysArr
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
          abort_signal: signal,
        })
        .then(res => res.json<{ keysArr?: string[]; key?: string }>())
        .then(d => {
          let output: string[];
          if (strategy === 'groupUniqArrayArray') {
            output = d.data[0].keysArr ?? [];
          } else {
            output = d.data
              .map(row => row.key)
              .filter((k): k is string => Boolean(k));
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
    dateRange,
    timestampValueExpression,
  }: {
    column: string;
    maxKeys?: number;
    dateRange?: [Date, Date];
    timestampValueExpression?: string;
  } & TableConnection) {
    // HDX-2480 delete line below to reenable json filters
    return []; // Need to disable JSON keys for the time being.
    const cacheKey = metricName
      ? `${connectionId}.${databaseName}.${tableName}.${column}.${metricName}.keys`
      : `${connectionId}.${databaseName}.${tableName}.${column}.keys`;

    return this.cache.getOrFetch<{ key: string; chType: string }[]>(
      cacheKey,
      async () => {
        const timeFilterCondition =
          dateRange && timestampValueExpression
            ? await timeFilterExpr({
                connectionId,
                databaseName,
                tableName,
                dateRange,
                dateRangeStartInclusive: true,
                dateRangeEndInclusive: true,
                timestampValueExpression,
                metadata: this,
              })
            : null;
        const whereConditions: ChSql[] = [
          ...(metricName ? [chSql`MetricName=${{ String: metricName }}`] : []),
          ...(timeFilterCondition ? [timeFilterCondition] : []),
        ];
        const where = whereConditions.length
          ? chSql`WHERE ${concatChSql(' AND ', ...whereConditions)}`
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
    dateRange,
    timestampValueExpression,
    signal,
  }: {
    databaseName: string;
    tableName: string;
    column: string;
    key?: string;
    maxValues?: number;
    dateRange?: [Date, Date];
    timestampValueExpression?: string;
    connectionId: string;
    signal?: AbortSignal;
  }) {
    const dateRangeCacheSuffix =
      dateRange && timestampValueExpression
        ? `${dateRange[0].getTime()}-${dateRange[1].getTime()}-${timestampValueExpression}`
        : '';
    const cacheKey = `${connectionId}.${databaseName}.${tableName}.${column}.${key}.${dateRangeCacheSuffix}.values`;

    const cachedValues = this.cache.get<string[]>(cacheKey);

    if (cachedValues != null) {
      return cachedValues;
    }

    const timeFilterCondition =
      dateRange && timestampValueExpression
        ? await timeFilterExpr({
            connectionId,
            databaseName,
            tableName,
            dateRange,
            dateRangeStartInclusive: true,
            dateRangeEndInclusive: true,
            timestampValueExpression,
            metadata: this,
          })
        : null;
    // `value != ''` stays first so existing behavior is preserved; source filters
    // and time filter are appended via AND when provided.
    const whereConditions: ChSql[] = [
      chSql`value != ''`,
      ...(timeFilterCondition ? [timeFilterCondition] : []),
    ];
    const where = chSql`WHERE ${concatChSql(' AND ', ...whereConditions)}`;

    const colMeta = key
      ? await this.getColumn({
          databaseName,
          tableName,
          column,
          connectionId,
        })
      : undefined;
    const jsonValueExpression =
      key && convertCHDataTypeToJSType(colMeta?.type ?? '') === JSDataType.JSON
        ? renderJsonStringSubcolumn(column, key)
        : undefined;

    let sql: ChSql;
    if (jsonValueExpression) {
      sql = chSql`
      SELECT DISTINCT ${{
        UNSAFE_RAW_SQL: jsonValueExpression,
      }} as value
      FROM ${tableExpr({ database: databaseName, table: tableName })}
      ${where}
      LIMIT ${{
        Int32: maxValues,
      }}
    `;
    } else if (key) {
      sql = chSql`
      SELECT DISTINCT ${{
        Identifier: column,
      }}[${{ String: key }}] as value
      FROM ${tableExpr({ database: databaseName, table: tableName })}
      ${where}
      LIMIT ${{
        Int32: maxValues,
      }}
    `;
    } else {
      sql = chSql`
      SELECT DISTINCT ${{
        Identifier: column,
      }} as value
      FROM ${tableExpr({ database: databaseName, table: tableName })}
      ${where}
      LIMIT ${{
        Int32: maxValues,
      }}
    `;
    }

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
          abort_signal: signal,
        })
        .then(res => res.json<{ value: string }>())
        .then(d => d.data.map(row => row.value));
      return values;
    });
  }

  private async getMapTextIndexKeyValues({
    databaseName,
    tableName,
    connectionId,
    queryOptions,
    dateRange,
    timestampValueExpression,
    signal,
  }: TableConnection & {
    queryOptions: TextIndexMapColumnQueryOptions;
    dateRange: [Date, Date];
    timestampValueExpression: string;
    signal?: AbortSignal;
  }): Promise<KeyValues[] | undefined> {
    const cacheKey = `${databaseName}.${tableName}.${connectionId}.${dateRange[0].toString()}.${dateRange[1].toString()}.${JSON.stringify(Array.from(queryOptions.entries()))}.${timestampValueExpression}.getMapTextIndexKeyValues`;
    return this.cache.getOrFetch(cacheKey, async () => {
      try {
        const sqlBranches: Array<ChSql> = [];
        for (const [columnName, info] of queryOptions.entries()) {
          const orChain = concatChSql(
            ' OR ',
            info.keys.map(
              k =>
                chSql`startsWith(token, ${{ String: `${k}${info.separator}` }})`,
            ),
          );
          const partsFilter = await this.partsOverlapFilter({
            databaseName,
            tableName,
            dateRange,
            timestampValueExpression,
          });
          const valueSql = chSql`substring(token, position(token, ${{ String: info.separator }}) + ${{ Int32: info.separator.length }})`;
          const sql = chSql`
        SELECT * FROM (
          SELECT ${{ String: columnName }} as column,
            substring(token, 1, position(token, ${{ String: info.separator }}) - 1) AS key,
            groupUniqArray(${{ Int32: info.limit }})(${valueSql}) AS value
          FROM mergeTreeTextIndex(${{ String: databaseName }}, ${{ String: tableName }}, ${{ String: info.indexName }})
          WHERE ${partsFilter}
            AND (${orChain})
            AND ${valueSql} != ''
          GROUP BY column, key
        )`;
          sqlBranches.push(sql);
        }
        const sql = concatChSql(' UNION ALL ', sqlBranches);

        return await this.clickhouseClient
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
            abort_signal: signal,
          })
          .then(res =>
            res.json<{ column: string; key: string; value: string[] }>(),
          )
          .then(d =>
            d.data.map(row => ({
              key: `${row.column}['${row.key}']`,
              value: row.value,
            })),
          );
      } catch (error) {
        // Text-index queries can fail transiently (part merged mid-read,
        // unsupported server, etc.). Isolate the failure so sibling
        // strategies (native text index, MV, raw table) still return data.
        console.warn(
          'getMapTextIndexKeyValues failed; skipping this strategy for the current batch',
          error,
        );
        return undefined;
      }
    });
  }

  private async getTextIndexKeyValues({
    databaseName,
    tableName,
    connectionId,
    queryOptions,
    dateRange,
    timestampValueExpression,
    signal,
  }: TableConnection & {
    queryOptions: TextIndexColumnQueryOptions;
    dateRange: [Date, Date];
    timestampValueExpression: string;
    signal?: AbortSignal;
  }): Promise<KeyValues[] | undefined> {
    const cacheKey = `${databaseName}.${tableName}.${connectionId}.${dateRange[0].toString()}.${dateRange[1].toString()}.${JSON.stringify(Array.from(queryOptions.entries()))}.${timestampValueExpression}.getTextIndexKeyValues`;
    return this.cache.getOrFetch(cacheKey, async () => {
      try {
        const sqlBranches: Array<ChSql> = [];
        for (const [columnName, info] of queryOptions.entries()) {
          const partsFilter = await this.partsOverlapFilter({
            databaseName,
            tableName,
            dateRange,
            timestampValueExpression,
          });
          const sql = chSql`
        SELECT * FROM (
          SELECT ${{ String: columnName }} AS key,
            groupUniqArray(${{ Int32: info.limit }})(token) AS value
          FROM mergeTreeTextIndex(${{ String: databaseName }}, ${{ String: tableName }}, ${{ String: info.indexName }})
          WHERE ${partsFilter}
            AND token != ''
          GROUP BY key
        )`;
          sqlBranches.push(sql);
        }
        const sql = concatChSql(' UNION ALL ', sqlBranches);

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
            abort_signal: signal,
          })
          .then(res => res.json<KeyValues>())
          .then(d => d.data);
        return values;
      } catch (error) {
        // See `getMapTextIndexKeyValues` — same isolation rationale.
        console.warn(
          'getTextIndexKeyValues failed; skipping this strategy for the current batch',
          error,
        );
        return undefined;
      }
    });
  }

  private async getMetadataMVKeyValues({
    databaseName,
    connectionId,
    dateRange,
    metadataMVs,
    queryOptions,
    maxValuesPerKey,
    signal,
  }: TableConnection & {
    queryOptions: MetadataMVQueryOptions;
    dateRange: [Date, Date];
    maxValuesPerKey: number;
    signal?: AbortSignal;
  }): Promise<KeyValues[] | undefined> {
    const cacheKey = `${databaseName}.${connectionId}.${dateRange[0].toString()}.${dateRange[1].toString()}.${maxValuesPerKey}.${JSON.stringify(metadataMVs)}.${JSON.stringify(Array.from(queryOptions.entries()))}.getMetadataMVKeyValues`;
    return this.cache.getOrFetch(cacheKey, async () => {
      if (!metadataMVs) {
        console.warn('getMetadataMVKeyValues: metadataMVs is undefined');
        return undefined;
      }

      const alignedDateRange = getAlignedDateRange(
        dateRange,
        metadataMVs.granularity,
      );
      const startExpr = renderStartOfBucketExpr(
        metadataMVs.granularity,
        chSql`fromUnixTimestamp64Milli(${{ Int64: alignedDateRange[0].getTime() }})`,
      );
      const endExpr = renderStartOfBucketExpr(
        metadataMVs.granularity,
        chSql`fromUnixTimestamp64Milli(${{ Int64: alignedDateRange[1].getTime() }})`,
      );
      const timeFilter = chSql`Timestamp >= ${startExpr} AND Timestamp <= ${endExpr}`;

      const sqlBranches: ChSql[] = [];
      for (const [mvName, entry] of queryOptions.entries()) {
        // this should only be one mv... but we have a for loop in case
        const branch: ChSql[] = [];
        for (const [columnName, keys] of entry) {
          const sql = chSql`(ColumnIdentifier = ${{ String: columnName }} AND Key IN (${concatChSql(
            ',',
            keys.map(key => chSql`${{ String: key }}`),
          )}))`;
          branch.push(sql);
        }
        const sql = chSql`
          SELECT * FROM (
            SELECT ColumnIdentifier, Key, groupUniqArray(${{ Int32: maxValuesPerKey }})(Value) as Values, sum(count) as total_count
            FROM ${tableExpr({ database: databaseName, table: mvName })}
            WHERE ${concatChSql(' OR ', branch)} 
              AND ${timeFilter}
              AND Value != ''
            GROUP BY ColumnIdentifier, Key
            ORDER BY ColumnIdentifier, Key, total_count DESC
            LIMIT ${{ Int32: maxValuesPerKey }} BY ColumnIdentifier, Key
          )`;
        sqlBranches.push(sql);
      }
      const sql = concatChSql(' UNION ALL ', sqlBranches);

      type BatchRow = {
        ColumnIdentifier: string;
        Key: string;
        Values: string[];
        total_count: number;
      };

      try {
        return await this.clickhouseClient
          .query<'JSON'>({
            query: sql.sql,
            query_params: sql.params,
            connectionId,
            clickhouse_settings: {
              ...this.getClickHouseSettings(),
              timeout_overflow_mode: 'break',
              max_execution_time: 15,
              max_rows_to_read: '0',
            },
            abort_signal: signal,
          })
          .then(res => res.json<BatchRow>())
          .then(d =>
            d.data.map(row => {
              if (row.ColumnIdentifier === 'NativeColumn') {
                return { key: row.Key, value: row.Values };
              }
              return {
                key: `${row.ColumnIdentifier}['${row.Key}']`,
                value: row.Values,
              };
            }),
          );
      } catch (e) {
        console.warn('Batched rollup query failed, falling back to per-key', e);
      }
      return undefined;
    });
  }

  async getAllFields({
    databaseName,
    tableName,
    connectionId,
    metricName,
    metadataMVs,
    dateRange,
    timestampValueExpression,
  }: TableConnection & {
    dateRange?: [Date, Date];
    timestampValueExpression?: string;
  }) {
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
            dateRange,
            timestampValueExpression,
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
          metadataMVs,
          dateRange,
          timestampValueExpression,
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
    let tableMetadata = await this.queryTableMetadata({
      cache: this.cache,
      database: databaseName,
      table: tableName,
      connectionId,
    });

    // For Distributed tables, fetch metadata of the underlying local table to get correct partition key, sorting key, etc.
    if (tableMetadata?.engine === 'Distributed') {
      tableMetadata.isPointerTable = true;
      try {
        const { cluster, database, table } =
          getDistributedTableArgs(tableMetadata) ?? {};

        if (!database || !table || !cluster) {
          throw new Error(
            `Could not parse underlying local table from Distributed table metadata: ${tableMetadata.create_table_query}`,
          );
        }

        // Query local table metadata from the specified cluster
        const localTableMetadata = await this.queryTableMetadata({
          cache: this.cache,
          database,
          table,
          cluster,
          connectionId,
        });

        if (!localTableMetadata) {
          throw new Error(
            `Could not find underlying local table metadata for Distributed table: ${database}.${table}`,
          );
        }

        // Override Distributed table metadata with local table metadata where relevant
        tableMetadata = {
          ...tableMetadata,
          ...pick(localTableMetadata, [
            // Distributed tables have these, but we make use of the
            // underlying local table's engine value for optimizations instead.
            'engine',
            'engine_full',
            // Distributed tables never have these, so we'll use the local table's
            'partition_key',
            'sorting_key',
            'primary_key',
            'sampling_key',
          ]),
          create_local_table_query: localTableMetadata?.create_table_query,
        };
      } catch (e) {
        console.error(
          'Failed to fetch underlying table metadata for Distributed table, using Distributed table metadata as fallback',
          e,
        );
      }
    }

    // Merge tables (including a Distributed table whose local table is a Merge
    // table) also route to other tables rather than holding their own data.
    if (tableMetadata?.engine === 'Merge') {
      tableMetadata.isPointerTable = true;
    }

    // partition_key which includes parenthesis, unlike other keys such as 'primary_key' or 'sorting_key'
    if (
      tableMetadata?.partition_key.startsWith('(') &&
      tableMetadata.partition_key.endsWith(')')
    ) {
      tableMetadata.partition_key = tableMetadata.partition_key.slice(1, -1);
    }
    return tableMetadata;
  }

  async getAllTableMetadata({
    databaseName,
    connectionId,
  }: {
    databaseName: string;
    connectionId: string;
  }) {
    const cacheKey = `${connectionId}.${databaseName}.tableMetadata`;
    return this.cache.getOrFetch(cacheKey, async () => {
      const sql = chSql`SELECT * FROM system.tables WHERE database = ${{ String: databaseName }}`;
      const json = await this.clickhouseClient
        .query<'JSON'>({
          connectionId,
          query: sql.sql,
          query_params: sql.params,
          clickhouse_settings: this.getClickHouseSettings(),
        })
        .then(res => res.json<TableMetadata>());
      return json.data;
    });
  }

  /** Reads the value of the setting with the given name from system.settings. */
  async getSetting({
    settingName,
    connectionId,
  }: {
    settingName: string;
    connectionId: string;
  }) {
    return this.cache.getOrFetch(`${connectionId}.${settingName}`, async () => {
      const sql = chSql`
          SELECT name, value
          FROM system.settings
          WHERE name = ${{ String: settingName }}
        `;

      try {
        const json = await this.clickhouseClient
          .query<'JSON'>({
            connectionId,
            query: sql.sql,
            query_params: sql.params,
            clickhouse_settings: this.getClickHouseSettings(),
          })
          .then(res => res.json<{ name: string; value: string }>());

        if (json.data.length > 0) {
          return json.data[0].value;
        }

        return undefined;
      } catch (e) {
        // Don't retry permissions errors, just silently return undefined
        if (e instanceof Error && e.message.includes('Not enough privileges')) {
          console.warn('Not enough privileges to fetch settings:', e);
          return undefined;
        }

        throw e;
      }
    });
  }

  /**
   * Returns true when the connected server is ClickHouse Cloud, detected by
   * checking whether `SharedMergeTree` is registered in `system.table_engines`.
   * The SharedMergeTree engine is compiled into Cloud builds only, so its
   * presence in the engine registry is a reliable Cloud signal that does not
   * depend on any user table existing.
   *
   * Result is cached per connection — Cloud-ness is a server property.
   */
  async isClickHouseCloud({
    connectionId,
  }: {
    connectionId: string;
  }): Promise<boolean> {
    const result = await this.cache.getOrFetch(
      `${connectionId}.isClickHouseCloud`,
      async () => {
        try {
          const query =
            "SELECT count() > 0 AS is_cloud FROM system.table_engines WHERE name = 'SharedMergeTree'";
          const json = await this.clickhouseClient
            .query<'JSON'>({
              connectionId,
              query,
              clickhouse_settings: this.getClickHouseSettings(),
              shouldSkipApplySettings: true,
            })
            .then(res => res.json<{ is_cloud: boolean }>());
          return json.data.length > 0 && json.data[0].is_cloud;
        } catch (e) {
          console.warn('Error detecting ClickHouse Cloud:', e);
          return undefined;
        }
      },
    );
    return result ?? false;
  }

  /**
   * Returns the parsed ClickHouse server version (from `SELECT version()`).
   * Returns undefined when the query fails or the value cannot be parsed; the
   * result is cached per connection and callers should treat undefined as
   * "unknown / assume older".
   */
  async getServerVersion({
    connectionId,
  }: {
    connectionId: string;
  }): Promise<ClickHouseVersion | undefined> {
    return this.cache.getOrFetch(`${connectionId}.serverVersion`, async () => {
      try {
        const json = await this.clickhouseClient
          .query<'JSON'>({
            connectionId,
            query: 'SELECT version() AS version',
            query_params: undefined,
            clickhouse_settings: this.getClickHouseSettings(),
            shouldSkipApplySettings: true,
          })
          .then(res => res.json<{ version: string }>());

        const versionString = json.data[0]?.version;
        if (!versionString) return undefined;
        return parseClickHouseVersion(versionString);
      } catch (e) {
        console.warn('Error fetching ClickHouse server version:', e);
        return undefined;
      }
    });
  }

  async getSettings({ connectionId }: { connectionId: string }) {
    return this.cache.getOrFetch(
      `${connectionId}.availableSettings`,
      async () => {
        const query = 'SELECT name, value FROM system.settings';
        try {
          const json = await this.clickhouseClient
            .query<'JSON'>({
              connectionId,
              query,
              query_params: undefined,
              clickhouse_settings: this.getClickHouseSettings(),
              shouldSkipApplySettings: true,
            })
            .then(res => res.json<{ name: string; value: string }>());

          return new Map(json.data.map(row => [row.name, row.value]));
        } catch (e) {
          // Don't retry permissions errors, just silently return undefined
          if (
            e instanceof Error &&
            e.message.includes('Not enough privileges')
          ) {
            console.warn(
              'Not enough privileges to fetch settings, may result in unoptimized queries:',
              e,
            );
            return new Map();
          }

          throw e;
        }
      },
    );
  }

  /**
   * Queries system.data_skipping_indices to retrieve skip index metadata for a table.
   * Results are cached using MetadataCache.
   *
   * Skip indices are ClickHouse data skipping indices that improve query performance
   * by allowing the query optimizer to skip reading entire data parts.
   */
  async getSkipIndices({
    databaseName,
    tableName,
    connectionId,
  }: {
    databaseName: string;
    tableName: string;
    connectionId: string;
  }): Promise<SkipIndexMetadata[]> {
    return this.cache.getOrFetch<SkipIndexMetadata[]>(
      `${connectionId}.${databaseName}.${tableName}.skipIndices`,
      async () => {
        const tableMetadata = await this.queryTableMetadata({
          cache: this.cache,
          database: databaseName,
          table: tableName,
          connectionId,
        });

        let database = databaseName;
        let table = tableName;
        let cluster: string | undefined;

        // For Distributed tables, query skip indices on the underlying local
        // table via the cluster() function so we reach the correct cluster.
        if (tableMetadata?.engine === 'Distributed') {
          const parsed = getDistributedTableArgs(tableMetadata);

          if (!parsed) {
            console.error(
              `Could not parse local table from Distributed table metadata: ${tableMetadata.create_table_query}`,
            );
          } else {
            database = parsed.database;
            table = parsed.table;
            cluster = parsed.cluster;
          }
        }

        try {
          return await this.querySkipIndices({
            database,
            table,
            connectionId,
            cluster,
          });
        } catch (e) {
          // Don't retry permissions errors, just silently return empty array
          if (
            e instanceof Error &&
            e.message.includes('Not enough privileges')
          ) {
            console.warn('Not enough privileges to fetch skip indices:', e);
            return [];
          }

          throw e;
        }
      },
    );
  }

  /**
   * Inspects the ClickHouse connection for OpenTelemetry telemetry tables.
   * Returns one coherent set of tables from the same database.
   *
   * When multiple databases contain the same table schema, this function prioritizes
   * returning a complete set from a single database rather than mixing tables from different databases.
   */
  async getOtelTables({ connectionId }: { connectionId: string }): Promise<{
    database: string;
    tables: {
      logs?: string;
      traces?: string;
      sessions?: string;
      metrics: {
        gauge?: string;
        sum?: string;
        summary?: string;
        histogram?: string;
        expHistogram?: string;
      };
    };
  } | null> {
    return this.cache.getOrFetch(`${connectionId}.otelTables`, async () => {
      const OTEL_TABLE_NAMES = [
        'otel_logs',
        'otel_traces',
        'hyperdx_sessions',
        'otel_metrics_gauge',
        'otel_metrics_sum',
        'otel_metrics_summary',
        'otel_metrics_histogram',
        'otel_metrics_exp_histogram',
      ];

      const tableNameParams = OTEL_TABLE_NAMES.map(
        t => chSql`${{ String: t }}`,
      );

      const sql = chSql`
          SELECT
            database,
            name
          FROM system.tables
          WHERE (database != 'system')
            AND (name IN (${concatChSql(',', tableNameParams)}))
          ORDER BY database, name
        `;

      try {
        const json = await this.clickhouseClient
          .query<'JSON'>({
            connectionId,
            query: sql.sql,
            query_params: sql.params,
            clickhouse_settings: this.getClickHouseSettings(),
          })
          .then(res => res.json<{ database: string; name: string }>());

        if (json.data.length === 0) {
          return null;
        }

        // Group tables by database
        const tablesByDatabase = new Map<string, Set<string>>();
        for (const row of json.data) {
          if (!tablesByDatabase.has(row.database)) {
            tablesByDatabase.set(row.database, new Set());
          }
          tablesByDatabase.get(row.database)!.add(row.name);
        }

        // Find the database with the most complete set of tables
        let bestDatabase = '';
        let bestScore = 0;

        for (const [database, tables] of tablesByDatabase.entries()) {
          // Score based on number of essential tables present
          let score = 0;
          if (tables.has('otel_logs')) score += 10;
          if (tables.has('otel_traces')) score += 10;
          if (tables.has('hyperdx_sessions')) score += 5;
          if (tables.has('otel_metrics_gauge')) score += 2;
          if (tables.has('otel_metrics_sum')) score += 2;
          if (tables.has('otel_metrics_histogram')) score += 2;
          if (tables.has('otel_metrics_summary')) score += 1;
          if (tables.has('otel_metrics_exp_histogram')) score += 1;

          if (score > bestScore) {
            bestScore = score;
            bestDatabase = database;
          }
        }

        if (!bestDatabase) {
          return null;
        }

        const selectedTables = tablesByDatabase.get(bestDatabase)!;

        return {
          database: bestDatabase,
          tables: {
            logs: selectedTables.has('otel_logs') ? 'otel_logs' : undefined,
            traces: selectedTables.has('otel_traces')
              ? 'otel_traces'
              : undefined,
            sessions: selectedTables.has('hyperdx_sessions')
              ? 'hyperdx_sessions'
              : undefined,
            metrics: {
              gauge: selectedTables.has('otel_metrics_gauge')
                ? 'otel_metrics_gauge'
                : undefined,
              sum: selectedTables.has('otel_metrics_sum')
                ? 'otel_metrics_sum'
                : undefined,
              summary: selectedTables.has('otel_metrics_summary')
                ? 'otel_metrics_summary'
                : undefined,
              histogram: selectedTables.has('otel_metrics_histogram')
                ? 'otel_metrics_histogram'
                : undefined,
              expHistogram: selectedTables.has('otel_metrics_exp_histogram')
                ? 'otel_metrics_exp_histogram'
                : undefined,
            },
          },
        };
      } catch (e) {
        if (e instanceof Error && e.message.includes('Not enough privileges')) {
          console.warn('Not enough privileges to fetch tables:', e);
          return null;
        }

        throw e;
      }
    });
  }

  /**
   * Parses a ClickHouse index expression to check if it uses the tokens() function.
   * Returns the inner expression if tokens() is found.
   *
   * Examples:
   * - tokens(Body) -> { hasTokens: true, innerExpression: 'Body' }
   * - tokens(lower(Body)) -> { hasTokens: true, innerExpression: 'lower(Body)' }
   * - lower(Body) -> { hasTokens: false }
   */
  static parseTokensExpression(expression: string):
    | {
        hasTokens: true;
        innerExpression: string;
      }
    | { hasTokens: false } {
    const tokensRegex = /^tokens\s*\((.*)\)$/i;
    const match = expression.trim().match(tokensRegex);

    if (match) {
      return {
        hasTokens: true,
        innerExpression: match[1].trim(),
      };
    }

    return { hasTokens: false };
  }

  async getValuesDistribution({
    chartConfig,
    key,
    samples = 100_000,
    limit = 100,
    source,
  }: {
    chartConfig: BuilderChartConfigWithDateRange;
    key: string;
    samples?: number;
    limit?: number;
    source: TSource | undefined;
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
      `${objectHash(cacheKeyConfig)}.${key}.valuesDistribution`,
      async () => {
        const renderedKey = await this.renderMetadataKeyExpression({
          databaseName: chartConfig.from.databaseName,
          tableName: chartConfig.from.tableName,
          connectionId: chartConfig.connection,
          keyExpression: key,
        });
        const config: BuilderChartConfigWithDateRange = {
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
          select: `${renderedKey} AS __hdx_value, count() as __hdx_count, __hdx_count / (sum(__hdx_count) OVER ()) * 100 AS __hdx_percentage`,
          orderBy: '__hdx_percentage DESC',
          groupBy: `__hdx_value`,
          limit: { limit },
        };

        const sql = await renderChartConfig(
          config,
          this,
          source?.querySettings,
        );

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

  private async doMetadataMVsAggregateColumn(
    { databaseName, tableName, connectionId }: TableConnection,
    columnName: string,
  ): Promise<boolean> {
    const allTableMetadata = await this.getAllTableMetadata({
      databaseName,
      connectionId,
    });
    for (const table of allTableMetadata) {
      if (
        table.engine !== 'MaterializedView' ||
        !table.create_table_query.startsWith(
          `CREATE MATERIALIZED VIEW ${databaseName}.${table.name} TO ${databaseName}.${tableName}`,
        )
      ) {
        continue;
      }
      return table.as_select.includes(columnName);
    }
    return false;
  }

  private async determineKeyValueFetchingStrategy({
    databaseName,
    tableName,
    connectionId,
    metadataMVs,
  }: TableConnection): Promise<KeyFetchingStrategies> {
    return this.cache.getOrFetch(
      `${connectionId}.${databaseName}.${tableName}.${JSON.stringify(metadataMVs)}.determineKeyValueFetchingStrategy`,
      async () => {
        const columnMetadata = await this.getColumns({
          databaseName,
          tableName,
          connectionId,
        });
        const mapTextIndexInfoLookup = await this.getMapColumnTextIndexes({
          databaseName,
          tableName,
          connectionId,
        });
        const nativeTextIndexInfoLookup =
          await this.getNativeArrayColumnTextIndexes({
            databaseName,
            tableName,
            connectionId,
          });

        const strategies: KeyFetchingStrategies = {
          mapTextIndexLookup: [],
          nativeTextIndexLookup: [],
          metadataMVs: [],
          rawTable: [],
        };

        for (const col of columnMetadata) {
          if (col.name === 'Timestamp') continue; // ignore the timestamp column
          // first check if this column is a map with a kv index
          if (mapTextIndexInfoLookup.get(col.name)?.kv) {
            strategies.mapTextIndexLookup.push(
              mapTextIndexInfoLookup.get(col.name)!,
            );
            continue;
          }
          // second: check if this column is a native column with a kv index
          if (nativeTextIndexInfoLookup.has(col.name)) {
            strategies.nativeTextIndexLookup.push(
              nativeTextIndexInfoLookup.get(col.name)!,
            );
            continue;
          }
          // third: check if there are metadataMVs that contain a SELECT to aggregate this field
          if (
            metadataMVs &&
            metadataMVs.kvRollupTable &&
            (await this.doMetadataMVsAggregateColumn(
              {
                databaseName,
                tableName: metadataMVs.kvRollupTable,
                connectionId,
              },
              col.name,
            ))
          ) {
            strategies.metadataMVs.push({
              columnName: col.name,
              mvName: metadataMVs.kvRollupTable,
            });
            continue;
          }
          // fallback: normal table scan
          strategies.rawTable.push(col.name);
        }

        return strategies;
      },
    );
  }

  /**
   * Fetches top values for one or more keys from the text index, metadataMV, or the raw table in a
   * single batched query. Falls back to getMapValues when no rollup is available.
   */
  async getAllKeyValues({
    databaseName,
    tableName,
    keyExpressions,
    maxValuesPerKey = 1000,
    connectionId,
    metadataMVs,
    dateRange,
    timestampValueExpression,
    signal,
  }: {
    databaseName: string;
    tableName: string;
    keyExpressions: string[];
    maxValuesPerKey?: number;
    connectionId: string;
    metadataMVs?: MetadataMaterializedViews;
    dateRange: [Date, Date];
    timestampValueExpression: string;
    signal?: AbortSignal;
  }): Promise<KeyValues[]> {
    if (keyExpressions.length === 0) return [];

    if (keyExpressions.length > GET_ALL_KEY_VALUES_CHUNK_SIZE) {
      const batched = await Promise.all(
        chunk(keyExpressions, GET_ALL_KEY_VALUES_CHUNK_SIZE).map(batch =>
          this.getAllKeyValues({
            databaseName,
            tableName,
            keyExpressions: batch,
            maxValuesPerKey,
            connectionId,
            metadataMVs,
            dateRange,
            timestampValueExpression,
            signal,
          }),
        ),
      );
      return batched.flat();
    }

    // Parse all keys into (rollupColumn, rollupKey) pairs
    const parsed = keyExpressions.map(keyExpr => {
      const path = parseKeyPath(keyExpr);
      const isMapKey = path.length >= 2;
      return {
        keyExpression: keyExpr,
        rollupColumn: isMapKey ? unquoteIdentifier(path[0]) : 'NativeColumn',
        rollupKey: isMapKey ? path[1] : unquoteIdentifier(path[0]),
        column: unquoteIdentifier(path[0]),
        mapKey: isMapKey ? path[1] : undefined,
      };
    });

    //   Strategy:
    //     JSON -> disabled
    //     Maps -> kv text index, then try to rollup (if in the MV statement), fallback to raw table scan
    //     Columns -> text index, then try the rollup (if in the MV statement), fallback to raw table scan
    const keyValueFetchingStrategies =
      await this.determineKeyValueFetchingStrategy({
        databaseName,
        tableName,
        connectionId,
        metadataMVs,
      });

    // build expressions for each query type
    const mapTextIndexQueryOptions: TextIndexMapColumnQueryOptions = new Map();
    const nativeTextIndexQueryOptions: TextIndexColumnQueryOptions = new Map();
    const metadataMVQueryOptions: MetadataMVQueryOptions = new Map();
    const rawQueryOptions: string[] = [];
    for (const key of parsed) {
      // first check text index
      if (key.mapKey) {
        const mapTextIndex = keyValueFetchingStrategies.mapTextIndexLookup.find(
          idx => idx.kv && idx.kv.mapColumn === key.column,
        );
        if (mapTextIndex?.kv) {
          let entry = mapTextIndexQueryOptions.get(key.column);
          if (!entry) {
            entry = {
              indexName: mapTextIndex.kv.indexName,
              limit: maxValuesPerKey,
              separator: mapTextIndex.kv.separator,
              keys: [],
            };
            mapTextIndexQueryOptions.set(key.column, entry);
          }
          entry.keys.push(key.mapKey);
          continue;
        }
      } else {
        const nativeTextIndex =
          keyValueFetchingStrategies.nativeTextIndexLookup.find(
            idx => idx.expression === key.column,
          );
        if (nativeTextIndex) {
          nativeTextIndexQueryOptions.set(key.column, {
            indexName: nativeTextIndex.name,
            limit: maxValuesPerKey,
          });
          continue;
        }
      }

      // then check metadataMVs
      const metadataMVEntry = keyValueFetchingStrategies.metadataMVs.find(
        v => v.columnName === key.column,
      );
      if (metadataMVEntry) {
        let tableEntry = metadataMVQueryOptions.get(metadataMVEntry.mvName);
        if (!tableEntry) {
          tableEntry = new Map();
          metadataMVQueryOptions.set(metadataMVEntry.mvName, tableEntry);
        }
        let columnEntry = tableEntry.get(key.rollupColumn);
        if (!columnEntry) {
          columnEntry = [];
          tableEntry.set(key.rollupColumn, columnEntry);
        }
        columnEntry.push(key.rollupKey);
        continue;
      }

      // fallback to raw table scan
      if (keyValueFetchingStrategies.rawTable.includes(key.column)) {
        if (key.mapKey) {
          rawQueryOptions.push(`${key.column}['${key.mapKey}']`);
        } else {
          rawQueryOptions.push(`${key.column}`);
        }
      }
    }

    // fire all the kv fetch queries
    const promises: Array<Promise<KeyValues[] | undefined>> = [];
    if (mapTextIndexQueryOptions.size > 0) {
      promises.push(
        this.getMapTextIndexKeyValues({
          databaseName,
          tableName,
          connectionId,
          queryOptions: mapTextIndexQueryOptions,
          dateRange,
          timestampValueExpression,
          signal,
        }),
      );
    }
    if (nativeTextIndexQueryOptions.size > 0) {
      promises.push(
        this.getTextIndexKeyValues({
          databaseName,
          tableName,
          connectionId,
          queryOptions: nativeTextIndexQueryOptions,
          dateRange,
          timestampValueExpression,
          signal,
        }),
      );
    }
    if (metadataMVQueryOptions.size > 0) {
      promises.push(
        this.getMetadataMVKeyValues({
          databaseName,
          tableName,
          connectionId,
          queryOptions: metadataMVQueryOptions,
          maxValuesPerKey,
          dateRange,
          metadataMVs,
          signal,
        }),
      );
    }
    if (rawQueryOptions.length > 0) {
      promises.push(
        this.getKeyValues({
          chartConfig: {
            from: {
              databaseName,
              tableName,
            },
            connection: connectionId,
            dateRange,
            timestampValueExpression,
            select: '',
            where: '',
          },
          keys: rawQueryOptions,
          limit: maxValuesPerKey,
          source: undefined,
          signal,
        }),
      );
    }
    return (await Promise.all(promises))
      .filter(v => v !== undefined)
      .flatMap(v => v);
  }

  async getKeyValues({
    chartConfig,
    keys,
    limit = 20,
    disableRowLimit = false,
    signal,
    source,
  }: {
    chartConfig: BuilderChartConfigWithDateRange;
    keys: string[];
    limit?: number;
    disableRowLimit?: boolean;
    signal?: AbortSignal;
    source:
      | Omit<TSource, 'connection'> /* for overlap with ISource type */
      | undefined;
  }): Promise<KeyValues[]> {
    const cacheKeyConfig = {
      ...pick(chartConfig, [
        'connection',
        'from',
        'dateRange',
        'where',
        'with',
        'filters',
      ]),
      keys,
      disableRowLimit,
    };
    return this.cache.getOrFetch(
      `${objectHash(cacheKeyConfig)}.getKeyValues`,
      async () => {
        if (keys.length === 0) return [];

        const renderedKeys = await Promise.all(
          keys.map(key =>
            this.renderMetadataKeyExpression({
              databaseName: chartConfig.from.databaseName,
              tableName: chartConfig.from.tableName,
              connectionId: chartConfig.connection,
              keyExpression: key,
            }),
          ),
        );

        // When disableRowLimit is true, query directly without CTE
        // Otherwise, use CTE with row limits for sampling
        const sqlConfig = disableRowLimit
          ? {
              ...chartConfig,
              select: renderedKeys
                .map((k, i) => `groupUniqArray(${limit})(${k}) AS param${i}`)
                .join(', '),
            }
          : await (async () => {
              // Build select expression that includes each of the given keys.
              // This avoids selecting entire JSON columns, which is significantly slower
              // than selecting just the JSON paths corresponding to the given keys.
              // paramN aliases are used to avoid issues with special characters or complex expressions in keys.
              const selectExpr =
                renderedKeys.map((k, i) => `${k} as param${i}`).join(', ') ||
                '*';

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

        const sql = await renderChartConfig(
          sqlConfig,
          this,
          source?.querySettings,
        );

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
            abort_signal: signal,
          })
          .then(res => res.json<Record<string, string[] | number[]>>());

        // TODO: Fix type issues mentioned in HDX-1548. value is not actually a
        // string[], sometimes it's { [key: string]: string; }
        return Object.entries(json?.data?.[0]).map(([key, value]) => ({
          key: keys[parseInt(key.replace('param', ''))],
          // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
          value: value?.filter(v => v != null && v !== '') as  // remove nulls and empty strings
            | string[]
            | number[],
        }));
      },
    );
  }

  async getKeyValuesWithMVs({
    chartConfig,
    keys,
    source,
    limit = 20,
    disableRowLimit,
    signal,
  }: {
    chartConfig: BuilderChartConfigWithDateRange;
    keys: string[];
    source: TSource | undefined;
    limit?: number;
    disableRowLimit?: boolean;
    signal?: AbortSignal;
  }): Promise<KeyValues[]> {
    const cacheKeyConfig = {
      ...pick(chartConfig, [
        'connection',
        'from',
        'dateRange',
        'where',
        'with',
        'filters',
      ]),
      keys,
      disableRowLimit,
    };
    return this.cache.getOrFetch(
      `${objectHash(cacheKeyConfig)}.getKeyValuesWithMVs`,
      async () => {
        if (keys.length === 0) return [];

        const defaultKeyValueCall = { chartConfig, keys };
        const canHaveMVs =
          source &&
          (source.kind === SourceKind.Log || source.kind === SourceKind.Trace);
        const getKeyValueCalls = canHaveMVs
          ? await optimizeGetKeyValuesCalls({
              chartConfig,
              keys,
              source,
              clickhouseClient: this.clickhouseClient,
              metadata: this,
              signal,
            })
          : [defaultKeyValueCall];

        const allResults = await Promise.all(
          getKeyValueCalls.map(async ({ chartConfig, keys }) =>
            this.getKeyValues({
              chartConfig,
              keys,
              limit,
              disableRowLimit,
              signal,
              source,
            }),
          ),
        );

        return allResults.flat();
      },
    );
  }
}

export type Field = {
  path: string[];
  type: string;
  jsType: JSDataType | null;
};

/**
 * Parses a bracket-notation key string into a path array.
 * e.g. `ResourceAttributes['service.name']` → `['ResourceAttributes', 'service.name']`
 *      `ServiceName` → `['ServiceName']`
 */
export function parseKeyPath(key: string): string[] {
  const singleIdx = key.indexOf("['");
  if (singleIdx !== -1 && key.endsWith("']")) {
    return [key.slice(0, singleIdx), key.slice(singleIdx + 2, -2)];
  }
  const doubleIdx = key.indexOf('["');
  if (doubleIdx !== -1 && key.endsWith('"]')) {
    return [key.slice(0, doubleIdx), key.slice(doubleIdx + 2, -2)];
  }
  return [key];
}

// Describes a table and potentially related views
export type TableConnection = {
  databaseName: string;
  tableName: string;
  connectionId: string;
  metricName?: string;
  metadataMVs?: MetadataMaterializedViews;
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

export function tcFromChartConfig(
  config?: BuilderChartConfig,
): TableConnection {
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
    metadataMVs:
      source && (isLogSource(source) || isTraceSource(source))
        ? source.metadataMaterializedViews
        : undefined,
  };
}

const __LOCAL_CACHE__ = new MetadataCache();

// TODO: better to init the Metadata object on the client side
// also the client should be able to choose the cache strategy
export const getMetadata = (clickhouseClient: BaseClickhouseClient) =>
  new Metadata(clickhouseClient, __LOCAL_CACHE__);
