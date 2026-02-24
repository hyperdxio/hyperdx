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
import { ChartConfigWithOptDateRange, QuerySettings } from '@/types';

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

export const computeResultSetRatio = (resultSet: ResponseJSON<any>) => {
  const _meta = resultSet.meta;
  const _data = resultSet.data;
  const timestampColumn = inferTimestampColumn(_meta ?? []);
  const _restColumns = _meta?.filter(m => m.name !== timestampColumn?.name);
  const firstColumn = _restColumns?.[0];
  const secondColumn = _restColumns?.[1];
  if (!firstColumn || !secondColumn) {
    throw new Error(
      `Unable to compute ratio - meta information: ${JSON.stringify(_meta)}.`,
    );
  }
  const ratioColumnName = `${firstColumn.name}/${secondColumn.name}`;
  const result = {
    ...resultSet,
    data: _data.map(row => ({
      [ratioColumnName]: computeRatio(
        row[firstColumn.name],
        row[secondColumn.name],
      ),
      ...(timestampColumn
        ? {
            [timestampColumn.name]: row[timestampColumn.name],
          }
        : {}),
    })),
    meta: [
      {
        name: ratioColumnName,
        type: 'Float64',
      },
      ...(timestampColumn
        ? [
            {
              name: timestampColumn.name,
              type: timestampColumn.type,
            },
          ]
        : []),
    ],
  };
  return result;
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
    };

    const metadata = getMetadata(this);
    const serverSettings = await metadata.getSettings({ connectionId });

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
    config = setChartSelectsAlias(config);
    const queries: ChSql[] = await Promise.all(
      splitChartConfigs(config).map(c =>
        renderChartConfig(c, metadata, querySettings),
      ),
    );

    const isTimeSeries = config.displayType === 'line';

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
    else if (resultSets.length > 1) {
      const metaSet = new Map<string, { name: string; type: string }>();
      const tsBucketMap = new Map<string, Record<string, string | number>>();
      for (const resultSet of resultSets) {
        // set up the meta data
        if (Array.isArray(resultSet.meta)) {
          for (const meta of resultSet.meta) {
            const key = meta.name;
            if (!metaSet.has(key)) {
              metaSet.set(key, meta);
            }
          }
        }

        const timestampColumn = inferTimestampColumn(resultSet.meta ?? []);
        const numericColumn = inferNumericColumn(resultSet.meta ?? []);
        const numericColumnName = numericColumn?.[0]?.name;
        for (const row of resultSet.data) {
          const _rowWithoutValue = numericColumnName
            ? Object.fromEntries(
                Object.entries(row).filter(
                  ([key]) => key !== numericColumnName,
                ),
              )
            : { ...row };
          const ts =
            timestampColumn != null
              ? row[timestampColumn.name]
              : isTimeSeries
                ? objectHash(_rowWithoutValue)
                : '__FIXED_TIMESTAMP__';
          if (tsBucketMap.has(ts)) {
            const existingRow = tsBucketMap.get(ts);
            tsBucketMap.set(ts, {
              ...existingRow,
              ...row,
            });
          } else {
            tsBucketMap.set(ts, row);
          }
        }
      }

      const isRatio =
        config.seriesReturnType === 'ratio' && resultSets.length === 2;

      const _resultSet: ResponseJSON<any> = {
        meta: Array.from(metaSet.values()),
        data: Array.from(tsBucketMap.values()),
      };
      // TODO: we should compute the ratio on the db side
      return isRatio ? computeResultSetRatio(_resultSet) : _resultSet;
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

export function chSqlToAliasMap(
  chSql: ChSql | undefined,
): Record<string, string> {
  const aliasMap: Record<string, string> = {};
  if (chSql == null) {
    return aliasMap;
  }

  try {
    const sql = parameterizedQueryToSql(chSql);

    // Remove the SETTINGS clause because `SQLParser` doesn't understand it.
    const [sqlWithoutSettingsClause] = extractSettingsClauseFromEnd(sql);

    // Replace JSON expressions with replacement tokens so that node-sql-parser can parse the SQL
    const { sqlWithReplacements, replacements: jsonReplacementsToExpressions } =
      replaceJsonExpressions(sqlWithoutSettingsClause);
    const parser = new SQLParser.Parser();
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- astify returns union type
    const ast = parser.astify(sqlWithReplacements, {
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
            aliasMap[column.as] = sqlWithReplacements.slice(
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
      for (const [replacement, original] of jsonReplacementsToExpressions) {
        if (aliasExpression.includes(replacement)) {
          aliasMap[alias] = aliasExpression.replaceAll(replacement, original);
        }
      }
    }
    return aliasMap;
  } catch (e) {
    console.error(
      'Error parsing alias map with JSON removed',
      e,
      'for query',
      chSql,
    );
  }

  return aliasMap;
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
