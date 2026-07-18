import type { ClickHouseClient as NodeClickHouseClient } from '@clickhouse/client';
import type {
  BaseResultSet,
  ClickHouseSettings,
  DataFormat,
  ResponseHeaders,
  ResponseJSON,
  Row,
} from '@clickhouse/client-common';
import type { ClickHouseClient as WebClickHouseClient } from '@clickhouse/client-web';
import * as SQLParser from 'node-sql-parser';
import objectHash from 'object-hash';

import { getMetadata, Metadata } from '@/core/metadata';
import {
  FIXED_TIME_BUCKET_EXPR_ALIAS,
  renderChartConfig,
  setChartSelectsAlias,
  splitChartConfigs,
} from '@/core/renderChartConfig';
import {
  extractSettingsClauseFromEnd,
  hashCode,
  replaceJsonExpressions,
  splitAndTrimWithBracket,
} from '@/core/utils';
import { isBuilderChartConfig } from '@/guards';
import { ChartConfigWithOptDateRange, QuerySettings, RatioMode } from '@/types';

// export @clickhouse/client-common types
export type {
  BaseResultSet,
  ClickHouseSettings,
  DataFormat,
  ResponseJSON,
  Row,
};

export enum JSDataType {
  Array = 'array',
  Date = 'date',
  Map = 'map',
  Number = 'number',
  String = 'string',
  Tuple = 'tuple',
  Bool = 'bool',
  JSON = 'json',
  Dynamic = 'dynamic', // json type will store anything as Dynamic type by default
}

export const getResponseHeaders = (response: Response): ResponseHeaders => {
  const headers: ResponseHeaders = {};
  response.headers.forEach((value, key) => {
    headers[key] = value;
  });
  return headers;
};

export const convertCHDataTypeToJSType = (
  dataType: string,
): JSDataType | null => {
  if (dataType.startsWith('Date')) {
    return JSDataType.Date;
  } else if (dataType.startsWith('Tuple')) {
    return JSDataType.Tuple;
  } else if (dataType.startsWith('Map')) {
    return JSDataType.Map;
  } else if (dataType.startsWith('Array')) {
    return JSDataType.Array;
  } else if (
    dataType.startsWith('Int') ||
    dataType.startsWith('UInt') ||
    dataType.startsWith('Float') ||
    // Nullable types are possible (charts)
    dataType.startsWith('Nullable(Int') ||
    dataType.startsWith('Nullable(UInt') ||
    dataType.startsWith('Nullable(Float')
  ) {
    return JSDataType.Number;
  } else if (
    dataType.startsWith('String') ||
    dataType.startsWith('Nullable(String)') ||
    dataType.startsWith('FixedString') ||
    dataType.startsWith('Enum') ||
    dataType.startsWith('UUID') ||
    dataType.startsWith('IPv4') ||
    dataType.startsWith('IPv6')
  ) {
    return JSDataType.String;
  } else if (dataType === 'Bool') {
    return JSDataType.Bool;
  } else if (dataType.startsWith('JSON')) {
    return JSDataType.JSON;
  } else if (dataType.startsWith('Dynamic')) {
    return JSDataType.Dynamic;
  } else if (dataType.startsWith('LowCardinality')) {
    return convertCHDataTypeToJSType(dataType.slice(15, -1));
  } else if (dataType.startsWith('Nullable(')) {
    return convertCHDataTypeToJSType(dataType.slice(9, -1));
  }

  return null;
};

export const isJSDataTypeJSONStringifiable = (
  dataType: JSDataType | null | undefined,
) => {
  return (
    dataType === JSDataType.Map ||
    dataType === JSDataType.Array ||
    dataType === JSDataType.JSON ||
    dataType === JSDataType.Tuple ||
    dataType === JSDataType.Dynamic
  );
};

export const extractInnerCHArrayJSType = (
  dataType: string,
): JSDataType | null => {
  if (dataType.trim().startsWith('Array(') && dataType.trim().endsWith(')')) {
    const innerType = dataType.trim().slice(6, -1);
    return convertCHDataTypeToJSType(innerType);
  }

  return null;
};

export const convertCHTypeToLuceneSearchType = (
  dataType: string,
): {
  type: JSDataType | null;
  isArray: boolean;
} => {
  let jsType = convertCHDataTypeToJSType(dataType);
  const isArray = jsType === JSDataType.Array;

  if (jsType === JSDataType.Map || jsType === JSDataType.Tuple) {
    throw new Error('Map or Tuple types cannot be searched with Lucene.');
  } else if (jsType === JSDataType.Date) {
    jsType = JSDataType.Number;
  } else if (
    jsType === JSDataType.Array &&
    extractInnerCHArrayJSType(dataType)
  ) {
    jsType = extractInnerCHArrayJSType(dataType);
  }

  return { type: jsType, isArray };
};

const hash = (input: string | number) => Math.abs(hashCode(`${input}`));
const paramHash = (str: string | number) => {
  return `HYPERDX_PARAM_${hash(str)}`;
};

export type ChSql = {
  sql: string;
  params: Record<string, any>;
};

type ParamTypes =
  | ChSql
  | ChSql[]
  | { Identifier: string }
  | { String: string }
  | { Float32: number }
  | { Float64: number }
  | { Int32: number }
  | { Int64: number }
  | { UNSAFE_RAW_SQL: string }
  | string; // TODO: Deprecate raw string interpolation

export const chSql = (
  strings: TemplateStringsArray,
  ...values: ParamTypes[]
): ChSql => {
  const sql = strings
    .map((str, i) => {
      const value = values[i];
      // if (typeof value === 'string') {
      //   console.error('Unsafe string detected', value, 'in', strings, values);
      // }

      return (
        str +
        (value == null
          ? ''
          : typeof value === 'string'
            ? value // If it's just a string sql literal
            : 'UNSAFE_RAW_SQL' in value
              ? value.UNSAFE_RAW_SQL
              : Array.isArray(value)
                ? value.map(v => v.sql).join('')
                : 'sql' in value
                  ? value.sql
                  : 'Identifier' in value
                    ? `{${paramHash(value.Identifier)}:Identifier}`
                    : 'String' in value
                      ? `{${paramHash(value.String)}:String}`
                      : 'Float32' in value
                        ? `{${paramHash(value.Float32)}:Float32}`
                        : 'Float64' in value
                          ? `{${paramHash(value.Float64)}:Float64}`
                          : 'Int32' in value
                            ? `{${paramHash(value.Int32)}:Int32}`
                            : 'Int64' in value
                              ? `{${paramHash(value.Int64)}:Int64}`
                              : '')
      );
    })
    .join('');

  return {
    sql,
    params: values.reduce((acc, value) => {
      return {
        ...acc,
        ...(value == null ||
        typeof value === 'string' ||
        'UNSAFE_RAW_SQL' in value
          ? {}
          : Array.isArray(value)
            ? value.reduce((acc, v) => {
                Object.assign(acc, v.params);
                return acc;
              }, {})
            : 'params' in value
              ? value.params
              : 'Identifier' in value
                ? { [paramHash(value.Identifier)]: value.Identifier }
                : 'String' in value
                  ? { [paramHash(value.String)]: value.String }
                  : 'Float32' in value
                    ? { [paramHash(value.Float32)]: value.Float32 }
                    : 'Float64' in value
                      ? { [paramHash(value.Float64)]: value.Float64 }
                      : 'Int32' in value
                        ? { [paramHash(value.Int32)]: value.Int32 }
                        : 'Int64' in value
                          ? { [paramHash(value.Int64)]: value.Int64 }
                          : {}),
      };
    }, {}),
  };
};

export const concatChSql = (sep: string, ...args: (ChSql | ChSql[])[]) => {
  return args.reduce(
    (acc: ChSql, arg) => {
      if (Array.isArray(arg)) {
        if (arg.length === 0) {
          return acc;
        }

        acc.sql +=
          (acc.sql.length > 0 ? sep : '') +
          arg
            .map(a => a.sql)
            .filter(Boolean) // skip empty string expressions
            .join(sep);
        acc.params = arg.reduce((acc, a) => {
          Object.assign(acc, a.params);
          return acc;
        }, acc.params);
      } else if (arg.sql.length > 0) {
        acc.sql += `${acc.sql.length > 0 ? sep : ''}${arg.sql}`;
        Object.assign(acc.params, arg.params);
      }
      return acc;
    },
    { sql: '', params: {} },
  );
};

const isChSqlEmpty = (chSql: ChSql | ChSql[]) => {
  if (Array.isArray(chSql)) {
    return chSql.every(c => c.sql.length === 0);
  }
  return chSql.sql.length === 0;
};

export const wrapChSqlIfNotEmpty = (
  sql: ChSql | ChSql[],
  left: string,
  right: string,
): ChSql | [] => {
  if (isChSqlEmpty(sql)) {
    return [];
  }

  return chSql`${left}${sql}${right}`;
};
export class ClickHouseQueryError extends Error {
  constructor(
    message: string,
    public query: string,
  ) {
    super(message);
    this.name = 'ClickHouseQueryError';
  }
}

/**
 * Heuristically detects whether a query error is a ClickHouse "missing/unknown
 * column" error. Useful for surfacing actionable hints (e.g. when a `SELECT *`
 * against a Distributed/Merge table references a column absent from some target
 * tables).
 */
export function isMissingColumnError(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error ?? '');
  return /Unknown (expression|identifier)|UNKNOWN_IDENTIFIER|Missing columns|NO_SUCH_COLUMN_IN_TABLE|There is no column|cannot be resolved/i.test(
    msg,
  );
}

/**
 * Returns columns referenced in given expression, where the expression is a comma-separated list of SQL expressions
 * E.g. "id, toStartOfInterval(timestamp, toIntervalDay(3)), user_id, json.a.b".
 */
export const extractColumnReferencesFromKey = (expr: string): string[] => {
  const parser = new SQLParser.Parser();

  const exprs = splitAndTrimWithBracket(expr);
  if (!exprs?.length) {
    return [];
  }

  return exprs.flatMap(expr => {
    try {
      // Extract map or array access expressions, e.g. map['key'] or array[1], since node-sql-parser does not support them.
      const mapAccessRegex = /\b[a-zA-Z0-9_]+\[([0-9]+|'[^']*')\]/g;
      const mapAccesses = expr.match(mapAccessRegex) || [];

      // Replace map/array accesses with a literal string ('') so that node-sql-parser ignores them
      const exprWithoutMaps = expr.replace(mapAccessRegex, "''");

      // Strip out any JSON type expressions, eg. in json.a.:Int64, remove the .:Int64 part
      const exprWithoutMapsOrJsonType = exprWithoutMaps.replace(
        /\.:[a-zA-Z0-9]+/g,
        '',
      );

      // Extract out any JSON path expressions, since node-sql-parser does not support them.
      const jsonPathRegex = /\b[a-zA-Z0-9_]+\.[a-zA-Z0-9_.]+/g;
      const jsonPaths = exprWithoutMapsOrJsonType.match(jsonPathRegex) || [];

      // Replace JSON paths and map/array accesses with a literal string ('') so that node-sql-parser ignores them
      const exprWithoutMapsOrJson = exprWithoutMapsOrJsonType.replace(
        jsonPathRegex,
        "''",
      );

      // Parse remaining column references with node-sql-parser
      const parsedColumnList = parser
        .columnList(`select ${exprWithoutMapsOrJson}`)
        .map(col => col.split('::')[2]);

      return [...new Set([...parsedColumnList, ...jsonPaths, ...mapAccesses])];
    } catch (e) {
      console.error('Error parsing column references from key', e, expr);
      return [];
    }
  });
};

const castToNumber = (value: string | number) => {
  if (typeof value === 'string') {
    if (value.trim() === '') {
      return NaN;
    }
    return Number(value);
  }
  return value;
};

export const computeRatio = (
  numeratorInput: string | number,
  denominatorInput: string | number,
) => {
  const numerator = castToNumber(numeratorInput);
  const denominator = castToNumber(denominatorInput);

  if (isNaN(numerator) || isNaN(denominator) || denominator === 0) {
    return NaN;
  }

  return numerator / denominator;
};

export const computeResultSetRatio = (
  resultSet: ResponseJSON<any>,
  // The numerator/denominator value columns. Passed explicitly by the only
  // caller (mergeResultSets) so we don't depend on column order — group-by
  // dimensions can be numeric and would otherwise be mistaken for an operand.
  operands: { numeratorName: string; denominatorName: string },
  // How a grouped ratio divides; see RatioModeSchema. Defaults to per-group.
  // Has no effect on ungrouped ratios (one row per bucket).
  mode: RatioMode = 'per_group',
) => {
  const _meta = resultSet.meta ?? [];
  const _data = resultSet.data;
  const numerator = _meta.find(m => m.name === operands.numeratorName);
  const denominator = _meta.find(m => m.name === operands.denominatorName);
  if (!numerator || !denominator) {
    throw new Error(
      `Unable to compute ratio - meta information: ${JSON.stringify(_meta)}.`,
    );
  }
  // Strip the collision-disambiguation suffix (see mergeResultSets) from the
  // rendered label so a same-alias ratio reads `count(x)/count(x)`, not
  // `count(x)/count(x)__1`.
  const denominatorLabel = denominator.name.replace(/__\d+$/, '');
  const ratioColumnName = `${numerator.name}/${denominatorLabel}`;
  // Carry through every non-operand column — the timestamp and any group-by
  // dimensions — so a grouped ratio renders one series per group instead of
  // collapsing into a single line.
  const passthroughColumns = _meta.filter(
    m => m.name !== numerator.name && m.name !== denominator.name,
  );

  // per_group: each row is divided by its own denominator (each group's own
  // rate). share_of_total: each row is divided by the total of the denominator
  // column across ALL groups in the same time bucket, so the grouped lines
  // decompose the blended rate and sum to the ungrouped value. For an ungrouped
  // ratio there's one row per bucket, so the bucket total equals that row's own
  // denominator and both modes coincide.
  const denominatorForRow =
    mode === 'share_of_total'
      ? buildBucketTotalDenominator(_data, _meta, denominator.name)
      : (row: Record<string, any>) => row[denominator.name] ?? NaN;

  return {
    ...resultSet,
    data: _data.map(row => {
      // A group absent from the (filtered) numerator query contributes zero, not
      // "no data" — so a zero-error group reads 0%, not N/A.
      const numeratorValue = row[numerator.name] ?? 0;
      return {
        [ratioColumnName]: computeRatio(numeratorValue, denominatorForRow(row)),
        ...Object.fromEntries(
          passthroughColumns.map(c => [c.name, row[c.name]]),
        ),
      };
    }),
    meta: [{ name: ratioColumnName, type: 'Float64' }, ...passthroughColumns],
  };
};

// Resolves the time-bucket column that groups rows into buckets. The query
// builder aliases the bucket FIXED_TIME_BUCKET_EXPR_ALIAS, so prefer that exact
// column and only fall back to the first Date-typed column for shapes without
// the alias. Without this preference a Date/DateTime group-by dimension ordered
// ahead of the real bucket would be mistaken for it, so share_of_total totals
// would be summed over the wrong column and the rendered shares silently wrong.
const resolveBucketColumn = (meta: Array<{ name: string; type: string }>) =>
  meta.find(m => m.name === FIXED_TIME_BUCKET_EXPR_ALIAS) ??
  inferTimestampColumn(meta);

// Builds a per-row lookup returning the total of the denominator column across
// all rows sharing a time bucket (share-of-total mode). Rows with no timestamp
// column all share one bucket, so a non-time-series grouped ratio becomes each
// group's share of the grand total.
const buildBucketTotalDenominator = (
  data: Record<string, any>[],
  meta: { name: string; type: string }[],
  denominatorName: string,
) => {
  const timestampColumn = resolveBucketColumn(meta);
  const bucketKey = (row: Record<string, any>) =>
    timestampColumn ? String(row[timestampColumn.name]) : '__all__';
  const totalByBucket = new Map<string, number>();
  for (const row of data) {
    const value = row[denominatorName];
    // A group missing from the denominator split has an undefined value;
    // castToNumber returns it as-is and Number.isNaN(undefined) is false, so
    // guard explicitly or it would poison the whole bucket total with NaN.
    const denom = value == null ? NaN : castToNumber(value);
    if (!Number.isNaN(denom)) {
      const key = bucketKey(row);
      totalByBucket.set(key, (totalByBucket.get(key) ?? 0) + denom);
    }
  }
  return (row: Record<string, any>) => totalByBucket.get(bucketKey(row)) ?? NaN;
};

/**
 * Joins the per-series result sets of a split metric query (one query per
 * series) back into a single result set, merging rows that share a time bucket
 * (and group-by dimensions, when grouped). When `isRatio` is set, the two
 * series are divided via {@link computeResultSetRatio}.
 *
 * Exported so the merge — the root of the grouped-ratio fix — can be unit
 * tested without a live ClickHouse.
 */
export const mergeResultSets = ({
  resultSets,
  isTimeSeries,
  isRatio,
  ratioMode,
}: {
  resultSets: ResponseJSON<any>[];
  isTimeSeries: boolean;
  isRatio: boolean;
  ratioMode?: RatioMode;
}): ResponseJSON<any> => {
  const metaSet = new Map<string, { name: string; type: string }>();
  const tsBucketMap = new Map<string, Record<string, string | number>>();

  // Seed metaSet with each split's value column in resultSet order, so the
  // joined meta is [value0, value1, ..., non-value columns]. This matches the
  // order of config.select that useChartNumberFormats indexes into.
  //
  // Two splits can resolve to the SAME value-column alias (e.g. a ratio of
  // count(request) filtered / unfiltered — the alias omits the WHERE filter).
  // If we let them share a column, the row merge below would clobber one
  // operand with the other and the ratio would be undefined. So rename a
  // colliding value column per split index and remember the (possibly renamed)
  // operand name so the ratio divides the right two columns.
  const operandNames: string[] = [];
  const renamedResultSets = resultSets.map((resultSet, splitIdx) => {
    const valueColumn = inferNumericColumn(resultSet.meta ?? [])?.[0];
    if (!valueColumn) {
      operandNames.push('');
      return resultSet;
    }
    const name = metaSet.has(valueColumn.name)
      ? `${valueColumn.name}__${splitIdx}`
      : valueColumn.name;
    operandNames.push(name);
    metaSet.set(name, { ...valueColumn, name });
    if (name === valueColumn.name) {
      return resultSet;
    }
    return {
      ...resultSet,
      meta: (resultSet.meta ?? []).map(m =>
        m.name === valueColumn.name ? { ...m, name } : m,
      ),
      data: resultSet.data.map(row => {
        const { [valueColumn.name]: value, ...rest } = row;
        return { ...rest, [name]: value };
      }),
    };
  });

  // Add other (non-value) columns to metaSet and merge rows.
  for (const resultSet of renamedResultSets) {
    if (Array.isArray(resultSet.meta)) {
      for (const meta of resultSet.meta) {
        if (!metaSet.has(meta.name)) {
          metaSet.set(meta.name, meta);
        }
      }
    }

    const timestampColumn = resolveBucketColumn(resultSet.meta ?? []);
    const numericColumn = inferNumericColumn(resultSet.meta ?? []);
    const numericColumnName = numericColumn?.[0]?.name;
    for (const row of resultSet.data) {
      const _rowWithoutValue = numericColumnName
        ? Object.fromEntries(
            Object.entries(row).filter(([key]) => key !== numericColumnName),
          )
        : { ...row };
      // When the series are grouped, two rows at the same time bucket but
      // different group values must stay distinct — key by (bucket + group
      // dims) via the hash of the row minus its value column. Without a
      // group dimension this collapses to the timestamp (or a fixed key),
      // preserving the original behavior.
      const hasGroupCols = Object.keys(_rowWithoutValue).some(
        key => key !== timestampColumn?.name,
      );
      const mergeKey = hasGroupCols
        ? objectHash(_rowWithoutValue)
        : timestampColumn != null
          ? row[timestampColumn.name]
          : isTimeSeries
            ? objectHash(_rowWithoutValue)
            : '__FIXED_TIMESTAMP__';
      if (tsBucketMap.has(mergeKey)) {
        tsBucketMap.set(mergeKey, { ...tsBucketMap.get(mergeKey), ...row });
      } else {
        tsBucketMap.set(mergeKey, row);
      }
    }
  }

  const merged: ResponseJSON<any> = {
    meta: Array.from(metaSet.values()),
    data: Array.from(tsBucketMap.values()),
  };

  if (isRatio) {
    // Read the operands positionally: a split with no inferable numeric value
    // column pushed '' (see above), so compacting with filter(Boolean) would
    // shift the surviving name into numeratorName and leave denominatorName
    // undefined — throwing "Unable to compute ratio" and failing the whole
    // chart response. If either operand is missing we can't divide, so fall
    // through and return the merged rows undivided.
    const [numeratorName, denominatorName] = operandNames;
    if (numeratorName && denominatorName) {
      // TODO: we should compute the ratio on the db side
      return computeResultSetRatio(
        merged,
        { numeratorName, denominatorName },
        ratioMode,
      );
    }
  }
  return merged;
};

export interface QueryInputs<Format extends DataFormat> {
  query: string;
  format?: Format;
  abort_signal?: AbortSignal;
  query_params?: Record<string, any>;
  clickhouse_settings?: ClickHouseSettings;
  connectionId?: string;
  queryId?: string;
  shouldSkipApplySettings?: boolean;
}

export type ClickhouseClientOptions = {
  host?: string;
  username?: string;
  password?: string;
  queryTimeout?: number;
  /** Application name, used as the client's HTTP user-agent header */
  application?: string;
  /** Defines how long the client will wait for a response from the ClickHouse server before aborting the request, in milliseconds */
  requestTimeout?: number;
};

export abstract class BaseClickhouseClient {
  protected readonly host?: string;
  protected readonly username?: string;
  protected readonly password?: string;
  protected readonly queryTimeout?: number;
  protected client?: WebClickHouseClient | NodeClickHouseClient;
  protected readonly application?: string;
  /*
   * Some clickhouse db's (the demo instance for example) make the
   * max_rows_to_read setting readonly and the query will fail if you try to
   * query with max_rows_to_read specified
   */
  protected maxRowReadOnly: boolean;
  protected requestTimeout: number = 3600000;

  constructor({
    host,
    username,
    password,
    queryTimeout,
    application,
    requestTimeout,
  }: ClickhouseClientOptions) {
    this.host = host!;
    this.username = username;
    this.password = password;
    this.queryTimeout = queryTimeout;
    this.maxRowReadOnly = false;
    this.application = application;
    if (requestTimeout != null && requestTimeout >= 0) {
      this.requestTimeout = requestTimeout;
    }
  }

  protected getClient(): WebClickHouseClient | NodeClickHouseClient {
    if (!this.client) {
      throw new Error(
        'ClickHouse client not initialized. Child classes must initialize the client.',
      );
    }
    return this.client;
  }

  async close(): Promise<void> {
    await this.client?.close();
  }

  protected logDebugQuery(
    query: string,
    query_params: Record<string, any> = {},
  ): void {
    let debugSql = '';
    try {
      debugSql = parameterizedQueryToSql({ sql: query, params: query_params });
    } catch (e) {
      debugSql = query;
    }

    console.debug('--------------------------------------------------------');

    console.debug('Sending Query:', debugSql);

    console.debug('--------------------------------------------------------');
  }

  protected async processClickhouseSettings({
    connectionId,
    externalClickhouseSettings,
  }: {
    connectionId?: string;
    externalClickhouseSettings?: ClickHouseSettings;
  }): Promise<ClickHouseSettings> {
    const clickhouse_settings = structuredClone(
      externalClickhouseSettings || {},
    );
    if (clickhouse_settings?.max_rows_to_read && this.maxRowReadOnly) {
      delete clickhouse_settings['max_rows_to_read'];
    }
    if (
      clickhouse_settings?.max_execution_time === undefined &&
      (this.queryTimeout || 0) > 0
    ) {
      clickhouse_settings.max_execution_time = this.queryTimeout;
    }

    const defaultSettings: ClickHouseSettings = {
      allow_experimental_analyzer: 1,
      date_time_output_format: 'iso',
      wait_end_of_query: 0,
      cancel_http_readonly_queries_on_client_close: 1,
      output_format_json_quote_64bit_integers: 1, // In 25.8, the default value for this was changed from 1 to 0. Due to JavaScript's poor precision for big integers, we should enable this https://github.com/ClickHouse/ClickHouse/pull/74079
    };

    // Only look up server-specific optimization settings when we have a
    // connectionId to scope the cache key. Without one the cache key would
    // be "undefined.availableSettings", which can collide across different
    // ClickHouse instances sharing the same MetadataCache singleton.
    const serverSettings = connectionId
      ? await getMetadata(this).getSettings({ connectionId })
      : undefined;

    const applySettingIfAvailable = (name: string, value: string) => {
      if (!serverSettings || !serverSettings.has(name)) return;
      // eslint-disable-next-line security/detect-object-injection
      defaultSettings[name] = value;
    };

    // Enables lazy materialization up to the given LIMIT
    applySettingIfAvailable('query_plan_optimize_lazy_materialization', '1');
    applySettingIfAvailable(
      'query_plan_max_limit_for_lazy_materialization',
      '100000',
    );
    // Enables skip indexes to be used for top k style queries up to the given LIMIT
    applySettingIfAvailable('use_skip_indexes_for_top_k', '1');
    applySettingIfAvailable(
      'query_plan_max_limit_for_top_k_optimization',
      '100000',
    );
    // TODO: HDX-3499 look into when we can and can't use this setting. For example, event deltas ORDER BY rand(), which is not compatible with this setting
    // applySettingIfAvailable('use_top_k_dynamic_filtering', '1');
    // Enables skip indexes to be used on data read
    applySettingIfAvailable('use_skip_indexes_on_data_read', '1');
    // Evaluate WHERE filters with mixed AND and OR conditions using skip indexes.
    // If value is 0, then skip indicies only used on AND queries
    applySettingIfAvailable('use_skip_indexes_for_disjunctions', '1');

    // Enables full-text (inverted index) search.
    applySettingIfAvailable('enable_full_text_index', '1');

    return {
      ...defaultSettings,
      ...clickhouse_settings,
    };
  }

  async query<Format extends DataFormat>(
    props: QueryInputs<Format>,
  ): Promise<BaseResultSet<ReadableStream, Format>> {
    let attempts = 0;
    // retry query if fails
    while (attempts < 2) {
      try {
        const res = await this.__query(props);
        return res;
      } catch (error: any) {
        if (
          !this.maxRowReadOnly &&
          error.type === 'READONLY' &&
          error.message.includes('max_rows_to_read')
        ) {
          // Indicate that the CH instance does not accept the max_rows_to_read setting
          this.maxRowReadOnly = true;
        } else {
          let err = error;
          // We should never error out here for debug info, so it's aggressively wrapped
          try {
            let debugSql = '';
            try {
              debugSql = parameterizedQueryToSql({
                sql: props.query,
                params: props.query_params ?? {},
              });
            } catch (e) {
              debugSql = props.query;
            }
            err = new ClickHouseQueryError(error.message, debugSql);
            err.cause = error;
          } catch (_) {
            // ignore
          }

          throw err;
        }
      }
      attempts++;
    }
    // should never get here
    throw new Error('ClickHouseClient query impossible codepath');
  }

  protected abstract __query<Format extends DataFormat>(
    inputs: QueryInputs<Format>,
  ): Promise<BaseResultSet<ReadableStream, Format>>;

  // TODO: only used when multi-series 'metrics' is selected (no effects on the events chart)
  // eventually we want to generate union CTEs on the db side instead of computing it on the client side
  async queryChartConfig({
    config,
    metadata,
    opts,
    querySettings,
  }: {
    config: ChartConfigWithOptDateRange;
    metadata: Metadata;
    opts?: {
      abort_signal?: AbortSignal;
      clickhouse_settings?: Record<string, any>;
    };
    querySettings: QuerySettings | undefined;
  }): Promise<ResponseJSON<Record<string, string | number>>> {
    if (isBuilderChartConfig(config)) {
      config = setChartSelectsAlias(config);
      if (config.seriesReturnType === 'ratio' && config.ratioMode !== 'share_of_total') {
        if (config.groupBy) {
          if (typeof config.groupBy === 'string') {
            config.groupBy = splitAndTrimWithBracket(config.groupBy).map(gb => ({
              type: 'string',
              valueExpression: gb,
              alias: gb, // Assign the raw expression as the alias so the CTE outputs exactly this column name
            }));
          } else if (Array.isArray(config.groupBy)) {
            config.groupBy = config.groupBy.map(gb => {
              if (typeof gb === 'string') {
                return { type: 'string', valueExpression: gb, alias: gb };
              }
              if (!gb.alias) {
                return { ...gb, alias: gb.valueExpression };
              }
              return gb;
            });
          }
        }
      }
    }
    const queries: ChSql[] = await Promise.all(
      splitChartConfigs(config).map(c =>
        renderChartConfig(c, metadata, querySettings),
      ),
    );

    const isTimeSeries = config.displayType === 'line';

    if (
      isBuilderChartConfig(config) &&
      config.seriesReturnType === 'ratio' &&
      config.ratioMode !== 'share_of_total' &&
      queries.length === 2 &&
      Array.isArray(config.select)
    ) {
      const q0Alias = config.select[0].alias ?? 'q0_val';
      const originalQ1Alias = config.select[1].alias ?? 'q1_val';
      let q1AliasOut = originalQ1Alias;
      if (q0Alias === originalQ1Alias) {
        q1AliasOut = `${originalQ1Alias}__1`;
      }
      const ratioAlias = `${q0Alias}/${originalQ1Alias}`;

      const joinKeys: string[] = [];
      if (isTimeSeries) {
        joinKeys.push('__hdx_time_bucket');
      }
      if (config.groupBy) {
        for (const gb of config.groupBy) {
          if (typeof gb === 'string') {
            joinKeys.push(gb);
          } else {
            joinKeys.push(gb.alias || gb.valueExpression);
          }
        }
      }

      // De-duplicate join keys just in case
      const uniqueJoinKeys = Array.from(new Set(joinKeys));

      let ratioSql: ChSql;
      const selectCols = [
        chSql`(q0.${{ Identifier: q0Alias }} / q1.${{ Identifier: originalQ1Alias }}) AS ${{ Identifier: ratioAlias }}`,
        chSql`q0.${{ Identifier: q0Alias }} AS ${{ Identifier: q0Alias }}`,
        chSql`q1.${{ Identifier: originalQ1Alias }} AS ${{ Identifier: q1AliasOut }}`,
        ...uniqueJoinKeys.map(k => chSql`${{ Identifier: k }}`),
      ];
      const selectClause = concatChSql(', ', selectCols);

      if (uniqueJoinKeys.length > 0) {
        const joinKeysSql = uniqueJoinKeys.map(
          k => chSql`${{ Identifier: k }}`,
        );
        const usingClause = concatChSql(', ', joinKeysSql);
        ratioSql = chSql`WITH q0 AS (${queries[0]}), q1 AS (${queries[1]}) SELECT ${selectClause} FROM q0 ANY LEFT JOIN q1 USING (${usingClause})`;
      } else {
        ratioSql = chSql`WITH q0 AS (${queries[0]}), q1 AS (${queries[1]}) SELECT ${selectClause} FROM q0 CROSS JOIN q1`;
      }

      const resp = await this.query<'JSON'>({
        query: ratioSql.sql,
        query_params: ratioSql.params,
        format: 'JSON',
        abort_signal: opts?.abort_signal,
        connectionId: config.connection,
        clickhouse_settings: opts?.clickhouse_settings,
      });

      return resp.json<any>();
    }

    const resultSets = await Promise.all(
      queries.map(async query => {
        const resp = await this.query<'JSON'>({
          query: query.sql,
          query_params: query.params,
          format: 'JSON',
          abort_signal: opts?.abort_signal,
          connectionId: config.connection,
          clickhouse_settings: opts?.clickhouse_settings,
        });
        return resp.json<any>();
      }),
    );

    if (resultSets.length === 1) {
      return resultSets[0];
    }
    // metrics -> join resultSets
    else if (isBuilderChartConfig(config) && resultSets.length > 1) {
      return mergeResultSets({
        resultSets,
        isTimeSeries,
        isRatio: config.seriesReturnType === 'ratio' && resultSets.length === 2,
        ratioMode: config.ratioMode,
      });
    }
    throw new Error('No result sets');
  }

  /**
   * Checks whether the given chart config is valid by running an
   * EXPLAIN query and returning whether the EXPLAIN succeeded
   **/
  async testChartConfigValidity({
    config,
    metadata,
    opts,
    querySettings,
  }: {
    config: ChartConfigWithOptDateRange;
    metadata: Metadata;
    opts?: {
      abort_signal?: AbortSignal;
      clickhouse_settings?: Record<string, any>;
    };
    querySettings: QuerySettings | undefined;
  }): Promise<{ isValid: boolean; rowEstimate?: number; error?: string }> {
    try {
      const renderedConfig = await renderChartConfig(
        config,
        metadata,
        querySettings,
      );
      const explainedQuery = chSql`EXPLAIN ESTIMATE ${renderedConfig}`;

      const result = await this.query<'JSON'>({
        query: explainedQuery.sql,
        query_params: explainedQuery.params,
        format: 'JSON',
        abort_signal: opts?.abort_signal,
        connectionId: config.connection,
        clickhouse_settings: opts?.clickhouse_settings,
      });

      const jsonResult = await result.json<{ rows: string | number }>();
      const rowEstimate = Number(jsonResult.data[0]?.rows);
      return {
        isValid: true,
        rowEstimate: Number.isNaN(rowEstimate) ? undefined : rowEstimate,
      };
    } catch (error: ClickHouseQueryError | unknown) {
      return {
        isValid: false,
        error:
          error instanceof ClickHouseQueryError
            ? error.message
            : String('Error while constructing materialized view query'),
      };
    }
  }
}

export const tableExpr = ({
  database,
  table,
}: {
  database: string;
  table: string;
}) => {
  return chSql`${{ Identifier: database }}.${{ Identifier: table }}`;
};

/**
 * SELECT
 *  aggFnIf(fieldToColumn(field), where),
 *  timeBucketing(Granularity, timeConversion(fieldToColumn(field))),
 * FROM db.table
 * WHERE where
 * GROUP BY timeBucketing, fieldToColumn(groupBy)
 * ORDER BY orderBy
 */

export function parameterizedQueryToSql({
  sql,
  params,
}: {
  sql: string;
  params: Record<string, any>;
}) {
  return Object.entries(params).reduce((acc, [key, value]) => {
    return acc.replace(new RegExp(`{${key}:\\w+}`, 'g'), value);
  }, sql);
}

// Table name used when re-parsing only the outer projection (see
// extractOuterSelectProjection). It is never executed, only fed to the parser.
const ALIAS_FALLBACK_TABLE = '__hdx_alias_src';

/**
 * Builds an alias map from a SELECT statement that node-sql-parser can parse.
 * Alias expressions are sliced out of `parsedSql` using the AST node
 * locations, so callers must pass the exact string that was parsed. Throws if
 * the SQL does not parse.
 */
function selectColumnsToAliasMap(
  parsedSql: string,
  jsonReplacements: Map<string, string>,
): Record<string, string> {
  const aliasMap: Record<string, string> = {};
  const parser = new SQLParser.Parser();

  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- astify returns union type
  const ast = parser.astify(parsedSql, {
    database: 'Postgresql',
    parseOptions: { includeLocations: true },
  }) as SQLParser.Select;

  if (ast.columns != null) {
    ast.columns.forEach(column => {
      if (column.as != null) {
        if (column.type === 'expr' && column.expr.type === 'column_ref') {
          aliasMap[column.as] =
            column.expr.array_index && column.expr.array_index[0]?.brackets
              ? // alias with brackets, ex: ResourceAttributes['service.name'] as service_name
                `${column.expr.column.expr.value}['${column.expr.array_index[0].index.value}']`
              : // normal alias
                column.expr.column.expr.value;
        } else if (column.expr.loc != null) {
          aliasMap[column.as] = parsedSql.slice(
            column.expr.loc.start.offset,
            column.expr.loc.end.offset,
          );
        } else {
          console.error('Unknown alias column type', column);
        }
      }
    });
  }

  // Replace the JSON replacement tokens with the original JSON expressions
  for (const [alias, aliasExpression] of Object.entries(aliasMap)) {
    for (const [replacement, original] of jsonReplacements) {
      if (aliasExpression.includes(replacement)) {
        aliasMap[alias] = aliasExpression.replaceAll(replacement, original);
      }
    }
  }

  return aliasMap;
}

/**
 * Returns the text of the outer SELECT projection (everything between the
 * top-level SELECT and its FROM). Leading WITH/CTE clauses, the WHERE clause,
 * and nested subqueries are skipped because their SELECT/FROM keywords sit
 * inside parentheses. Returns null when no top-level SELECT...FROM is found.
 *
 * Used as a fallback by chSqlToAliasMap: the alias map only needs the outer
 * projection's `expr AS alias` pairs, so when the full statement is
 * unparseable by node-sql-parser (e.g. a sampling CTE containing
 * `CAST(x AS UInt32)`), re-parsing just the projection still recovers them.
 */
function extractOuterSelectProjection(sql: string): string | null {
  let parenDepth = 0;
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let inBacktick = false;
  let projectionStart = -1;

  const isWordChar = (c: string | undefined) =>
    c != null && /[A-Za-z0-9_]/.test(c);
  const matchesKeywordAt = (index: number, keyword: string): boolean => {
    if (sql.slice(index, index + keyword.length).toUpperCase() !== keyword) {
      return false;
    }
    // Require word boundaries so we don't match inside a longer identifier.
    return (
      !isWordChar(sql[index - 1]) && !isWordChar(sql[index + keyword.length])
    );
  };

  for (let i = 0; i < sql.length; i++) {
    const c = sql[i];

    // Skip over string / quoted-identifier contents so keywords and brackets
    // inside them are ignored.
    if (inSingleQuote) {
      if (c === "'") inSingleQuote = false;
      continue;
    }
    if (inDoubleQuote) {
      if (c === '"') inDoubleQuote = false;
      continue;
    }
    if (inBacktick) {
      if (c === '`') inBacktick = false;
      continue;
    }
    // Skip SQL comments so keywords / brackets inside them are ignored.
    if (c === '-' && sql[i + 1] === '-') {
      const lineEnd = sql.indexOf('\n', i + 2);
      if (lineEnd === -1) break;
      i = lineEnd;
      continue;
    }
    if (c === '/' && sql[i + 1] === '*') {
      const blockEnd = sql.indexOf('*/', i + 2);
      if (blockEnd === -1) break;
      i = blockEnd + 1;
      continue;
    }
    if (c === "'") {
      inSingleQuote = true;
      continue;
    }
    if (c === '"') {
      inDoubleQuote = true;
      continue;
    }
    if (c === '`') {
      inBacktick = true;
      continue;
    }
    if (c === '(') {
      parenDepth++;
      continue;
    }
    if (c === ')') {
      parenDepth--;
      continue;
    }
    if (parenDepth !== 0) {
      continue;
    }

    if (projectionStart === -1) {
      if (matchesKeywordAt(i, 'SELECT')) {
        projectionStart = i + 'SELECT'.length;
        i = projectionStart - 1;
      }
    } else if (matchesKeywordAt(i, 'FROM')) {
      return sql.slice(projectionStart, i).trim();
    }
  }

  return null;
}

export function chSqlToAliasMap(
  chSql: ChSql | undefined,
): Record<string, string> {
  if (chSql == null || !chSql.sql) {
    return {};
  }

  try {
    const sql = parameterizedQueryToSql(chSql);

    // Remove the SETTINGS clause because `SQLParser` doesn't understand it.
    const [sqlWithoutSettingsClause] = extractSettingsClauseFromEnd(sql);

    // Replace JSON expressions with replacement tokens so that node-sql-parser can parse the SQL
    const { sqlWithReplacements, replacements: jsonReplacementsToExpressions } =
      replaceJsonExpressions(sqlWithoutSettingsClause);

    try {
      return selectColumnsToAliasMap(
        sqlWithReplacements,
        jsonReplacementsToExpressions,
      );
    } catch (fullParseError) {
      // node-sql-parser's Postgresql dialect rejects some ClickHouse-specific
      // SQL (e.g. `CAST(x AS UInt32)` in a sampling CTE, or parameterized
      // identifiers). The alias map only needs the outer SELECT projection, so
      // retry with `SELECT <projection> FROM <table>` before giving up.
      const projection = extractOuterSelectProjection(sqlWithReplacements);
      if (projection == null) {
        throw fullParseError;
      }
      return selectColumnsToAliasMap(
        `SELECT ${projection} FROM ${ALIAS_FALLBACK_TABLE}`,
        jsonReplacementsToExpressions,
      );
    }
  } catch (e) {
    console.error(
      'Error parsing alias map with JSON removed',
      e,
      'for query',
      chSql,
    );
  }

  return {};
}

export type ColumnMetaType = { name: string; type: string };
export function filterColumnMetaByType(
  meta: Array<ColumnMetaType>,
  types: JSDataType[],
): Array<ColumnMetaType> | undefined {
  return meta.filter(column => {
    const jsType = convertCHDataTypeToJSType(column.type);
    return jsType != null && types.includes(jsType);
  });
}

export function inferTimestampColumn(
  // from: https://github.com/ClickHouse/clickhouse-js/blob/442392c83834f313a964f9e5bd7ff44474631755/packages/client-common/src/clickhouse_types.ts#L8C3-L8C47
  meta: Array<ColumnMetaType>,
) {
  return filterColumnMetaByType(meta, [JSDataType.Date])?.[0];
}

export function inferNumericColumn(meta: Array<ColumnMetaType>) {
  return filterColumnMetaByType(meta, [JSDataType.Number]);
}

export type ColumnMeta = {
  codec_expression: string;
  comment: string;
  default_expression: string;
  default_type: string;
  name: string;
  ttl_expression: string;
  type: string;
};
