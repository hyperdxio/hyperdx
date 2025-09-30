import type { ClickHouseClient as NodeClickHouseClient } from '@clickhouse/client';
import type {
  BaseResultSet,
  ClickHouseSettings,
  DataFormat,
  ResponseHeaders,
  ResponseJSON,
  Row,
} from '@clickhouse/client-common';
import { isSuccessfulResponse } from '@clickhouse/client-common';
import type { ClickHouseClient as WebClickHouseClient } from '@clickhouse/client-web';
import * as SQLParser from 'node-sql-parser';
import objectHash from 'object-hash';

import { Metadata } from '@/metadata';
import {
  renderChartConfig,
  setChartSelectsAlias,
  splitChartConfigs,
} from '@/renderChartConfig';
import { ChartConfigWithOptDateRange, SQLInterval } from '@/types';
import { hashCode } from '@/utils';

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

export const convertCHTypeToPrimitiveJSType = (dataType: string) => {
  const jsType = convertCHDataTypeToJSType(dataType);

  if (
    jsType === JSDataType.Map ||
    jsType === JSDataType.Array ||
    jsType === JSDataType.Tuple
  ) {
    throw new Error('Map, Array or Tuple type is not a primitive type');
  } else if (jsType === JSDataType.Date) {
    return JSDataType.Number;
  }

  return jsType;
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

export function extractColumnReference(
  sql: string,
  maxIterations = 10,
): string | null {
  let iterations = 0;

  // Loop until we remove all function calls and get just the column, with a maximum limit
  while (/\w+\([^()]*\)/.test(sql) && iterations < maxIterations) {
    // Replace the outermost function with its content
    sql = sql.replace(/\w+\(([^()]*)\)/, '$1');
    iterations++;
  }

  // If we reached the max iterations without resolving, return null to indicate an issue
  return iterations < maxIterations ? sql.trim() : null;
}

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
}

export type ClickhouseClientOptions = {
  host?: string;
  username?: string;
  password?: string;
  queryTimeout?: number;
  /** Application name, used as the client's HTTP user-agent header */
  application?: string;
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
  protected requestTimeout: number = 3600000; // TODO: make configurable

  constructor({
    host,
    username,
    password,
    queryTimeout,
    application,
  }: ClickhouseClientOptions) {
    this.host = host!;
    this.username = username;
    this.password = password;
    this.queryTimeout = queryTimeout;
    this.maxRowReadOnly = false;
    this.application = application;
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

    // eslint-disable-next-line no-console
    console.debug('--------------------------------------------------------');
    // eslint-disable-next-line no-console
    console.debug('Sending Query:', debugSql);
    // eslint-disable-next-line no-console
    console.debug('--------------------------------------------------------');
  }

  protected processClickhouseSettings(
    external_clickhouse_settings?: ClickHouseSettings,
  ): ClickHouseSettings {
    const clickhouse_settings = structuredClone(
      external_clickhouse_settings || {},
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

    return {
      allow_experimental_analyzer: 1,
      date_time_output_format: 'iso',
      wait_end_of_query: 0,
      cancel_http_readonly_queries_on_client_close: 1,
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
  }: {
    config: ChartConfigWithOptDateRange;
    metadata: Metadata;
    opts?: {
      abort_signal?: AbortSignal;
      clickhouse_settings?: Record<string, any>;
    };
  }): Promise<ResponseJSON<Record<string, string | number>>> {
    config = setChartSelectsAlias(config);
    const queries: ChSql[] = await Promise.all(
      splitChartConfigs(config).map(c => renderChartConfig(c, metadata)),
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
    const parser = new SQLParser.Parser();
    const ast = parser.astify(sql, {
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
            aliasMap[column.as] = sql.slice(
              column.expr.loc.start.offset,
              column.expr.loc.end.offset,
            );
          } else {
            console.error('Unknown alias column type', column);
          }
        }
      });
    }
  } catch (e) {
    console.error('Error parsing alias map', e, 'for query', chSql);
  }

  return aliasMap;
}

export type ColumnMetaType = { name: string; type: string };
export function filterColumnMetaByType(
  meta: Array<ColumnMetaType>,
  types: JSDataType[],
): Array<ColumnMetaType> | undefined {
  return meta.filter(column =>
    types.includes(convertCHDataTypeToJSType(column.type) as JSDataType),
  );
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
