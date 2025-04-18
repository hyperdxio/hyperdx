import type {
  BaseResultSet,
  DataFormat,
  ResponseHeaders,
  ResponseJSON,
} from '@clickhouse/client-common';
import { isSuccessfulResponse } from '@clickhouse/client-common';
import * as SQLParser from 'node-sql-parser';

import { SQLInterval } from '@/types';
import { hashCode, isBrowser, isNode, timeBucketByGranularity } from '@/utils';

export enum JSDataType {
  Array = 'array',
  Date = 'date',
  Map = 'map',
  Number = 'number',
  String = 'string',
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

export const convertCHTypeToPrimitiveJSType = (dataType: string) => {
  const jsType = convertCHDataTypeToJSType(dataType);

  if (jsType === JSDataType.Map || jsType === JSDataType.Array) {
    throw new Error('Map type is not a primitive type');
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

export type ClickhouseClientOptions = {
  host: string;
  username?: string;
  password?: string;
};

export class ClickhouseClient {
  private readonly host: string;
  private readonly username?: string;
  private readonly password?: string;

  constructor({ host, username, password }: ClickhouseClientOptions) {
    this.host = host;
    this.username = username;
    this.password = password;
  }

  // https://github.com/ClickHouse/clickhouse-js/blob/1ebdd39203730bb99fad4c88eac35d9a5e96b34a/packages/client-web/src/connection/web_connection.ts#L151
  async query<T extends DataFormat>({
    query,
    format = 'JSON',
    query_params = {},
    abort_signal,
    clickhouse_settings,
    connectionId,
    queryId,
  }: {
    query: string;
    format?: string;
    abort_signal?: AbortSignal;
    query_params?: Record<string, any>;
    clickhouse_settings?: Record<string, any>;
    connectionId?: string;
    queryId?: string;
  }): Promise<BaseResultSet<any, T>> {
    const isLocalMode = this.username != null && this.password != null;
    const includeCredentials = !isLocalMode;
    const includeCorsHeader = isLocalMode;

    const searchParams = new URLSearchParams([
      ...(includeCorsHeader ? [['add_http_cors_header', '1']] : []),
      ['query', query],
      ['default_format', format],
      ['date_time_output_format', 'iso'],
      ['wait_end_of_query', '0'],
      ['cancel_http_readonly_queries_on_client_close', '1'],
      ...(this.username ? [['user', this.username]] : []),
      ...(this.password ? [['password', this.password]] : []),
      ...(queryId ? [['query_id', queryId]] : []),
      ...Object.entries(query_params).map(([key, value]) => [
        `param_${key}`,
        value,
      ]),
      ...Object.entries(clickhouse_settings ?? {}).map(([key, value]) => [
        key,
        value,
      ]),
    ]);

    let debugSql = '';
    try {
      debugSql = parameterizedQueryToSql({ sql: query, params: query_params });
    } catch (e) {
      debugSql = query;
    }

    // eslint-disable-next-line no-console
    console.log('--------------------------------------------------------');
    // eslint-disable-next-line no-console
    console.log('Sending Query:', debugSql);
    // eslint-disable-next-line no-console
    console.log('--------------------------------------------------------');

    if (isBrowser) {
      // TODO: check if we can use the client-web directly
      const { ResultSet } = await import('@clickhouse/client-web');

      const headers = {};
      if (!isLocalMode && connectionId) {
        headers['x-hyperdx-connection-id'] = connectionId;
      }
      // https://github.com/ClickHouse/clickhouse-js/blob/1ebdd39203730bb99fad4c88eac35d9a5e96b34a/packages/client-web/src/connection/web_connection.ts#L200C7-L200C23
      const response = await fetch(`${this.host}/?${searchParams.toString()}`, {
        ...(includeCredentials ? { credentials: 'include' } : {}),
        signal: abort_signal,
        method: 'GET',
        headers,
      });

      // TODO: Send command to CH to cancel query on abort_signal
      if (!response.ok) {
        if (!isSuccessfulResponse(response.status)) {
          const text = await response.text();
          throw new ClickHouseQueryError(`${text}`, debugSql);
        }
      }

      if (response.body == null) {
        // TODO: Handle empty responses better?
        throw new Error('Unexpected empty response from ClickHouse');
      }
      return new ResultSet<T>(
        response.body,
        format as T,
        queryId ?? '',
        getResponseHeaders(response),
      );
    } else if (isNode) {
      const { createClient } = await import('@clickhouse/client');
      const _client = createClient({
        url: this.host,
        username: this.username,
        password: this.password,
        clickhouse_settings: {
          date_time_output_format: 'iso',
          wait_end_of_query: 0,
          cancel_http_readonly_queries_on_client_close: 1,
        },
      });

      // TODO: Custom error handling
      return _client.query({
        query,
        query_params,
        format: format as T,
        abort_signal,
        clickhouse_settings,
        query_id: queryId,
      }) as unknown as BaseResultSet<any, T>;
    } else {
      throw new Error(
        'ClickhouseClient is only supported in the browser or node environment',
      );
    }
  }
}

export const testLocalConnection = async ({
  host,
  username,
  password,
}: {
  host: string;
  username: string;
  password: string;
}): Promise<boolean> => {
  try {
    const client = new ClickhouseClient({ host, username, password });
    const result = await client.query({
      query: 'SELECT 1',
      format: 'TabSeparatedRaw',
    });
    return result.text().then(text => text.trim() === '1');
  } catch (e) {
    console.warn('Failed to test local connection', e);
    return false;
  }
};

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
