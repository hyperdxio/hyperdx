/**
 * Internal legacy ClickHouse type bindings used by the in-tree common-utils
 * core/* modules during the Berg cleanup. These are not part of the public
 * package surface — they exist solely to keep core/metadata.ts and
 * queryParser.ts compiling against the deleted `@/clickhouse` shim until
 * the Berg migration owns those modules entirely.
 *
 * Nothing here imports from @clickhouse/client-* — the types are nominal.
 */
export enum JSDataType {
  Array = 'array',
  Date = 'date',
  Map = 'map',
  Number = 'number',
  String = 'string',
  Tuple = 'tuple',
  Bool = 'bool',
  JSON = 'json',
  Dynamic = 'dynamic',
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

export type ColumnMetaType = { name: string; type: string };

export type ChSql = { sql: string; params: Record<string, any> };

export function convertCHDataTypeToJSType(dataType: string): JSDataType | null {
  if (!dataType) return null;
  const t = dataType.toLowerCase();
  if (t.startsWith('date') || t.startsWith('timestamp')) return JSDataType.Date;
  if (t.startsWith('tuple') || t.startsWith('row(')) return JSDataType.Tuple;
  if (t.startsWith('map')) return JSDataType.Map;
  if (t.startsWith('array')) return JSDataType.Array;
  if (
    t.startsWith('int') ||
    t.startsWith('uint') ||
    t.startsWith('bigint') ||
    t.startsWith('smallint') ||
    t.startsWith('tinyint') ||
    t.startsWith('float') ||
    t.startsWith('double') ||
    t.startsWith('real') ||
    t.startsWith('decimal') ||
    t.startsWith('nullable(int') ||
    t.startsWith('nullable(uint') ||
    t.startsWith('nullable(float')
  )
    return JSDataType.Number;
  if (
    t.startsWith('string') ||
    t.startsWith('varchar') ||
    t.startsWith('char') ||
    t.startsWith('nullable(string') ||
    t.startsWith('fixedstring') ||
    t.startsWith('enum') ||
    t.startsWith('uuid') ||
    t.startsWith('ipv4') ||
    t.startsWith('ipv6')
  )
    return JSDataType.String;
  if (t === 'bool' || t === 'boolean') return JSDataType.Bool;
  if (t.startsWith('json')) return JSDataType.JSON;
  if (t.startsWith('dynamic')) return JSDataType.Dynamic;
  if (t.startsWith('lowcardinality(')) {
    return convertCHDataTypeToJSType(dataType.slice(15, -1));
  }
  if (t.startsWith('nullable(')) {
    return convertCHDataTypeToJSType(dataType.slice(9, -1));
  }
  return null;
}

export function extractInnerCHArrayJSType(dataType: string): JSDataType | null {
  const trimmed = dataType.trim();
  if (trimmed.startsWith('Array(') && trimmed.endsWith(')')) {
    return convertCHDataTypeToJSType(trimmed.slice(6, -1));
  }
  if (trimmed.startsWith('array(') && trimmed.endsWith(')')) {
    return convertCHDataTypeToJSType(trimmed.slice(6, -1));
  }
  return null;
}

export function filterColumnMetaByType(
  meta: Array<ColumnMetaType>,
  types: JSDataType[],
): Array<ColumnMetaType> | undefined {
  return meta.filter(column => {
    const jsType = convertCHDataTypeToJSType(column.type);
    return jsType != null && types.includes(jsType);
  });
}

export function chSql(strings: TemplateStringsArray, ...values: any[]): ChSql {
  // Berg has no parameterised SQL surface in common-utils any more.
  // Stub: concatenate strings + values literally so the few callers
  // (tableExpr, etc.) produce parseable SQL fragments.
  let out = '';
  for (let i = 0; i < strings.length; i++) {
    out += strings[i];
    if (i < values.length) {
      const v = values[i];
      if (v == null) continue;
      if (typeof v === 'string') out += v;
      else if (typeof v === 'object') {
        if ('UNSAFE_RAW_SQL' in v) out += v.UNSAFE_RAW_SQL;
        else if ('Identifier' in v) out += `\`${v.Identifier}\``;
        else if ('String' in v)
          out += `'${String(v.String).replace(/'/g, "''")}'`;
        else if ('Float32' in v) out += String(v.Float32);
        else if ('Float64' in v) out += String(v.Float64);
        else if ('Int32' in v) out += String(v.Int32);
        else if ('Int64' in v) out += String(v.Int64);
        else if ('sql' in v) out += v.sql;
      }
    }
  }
  return { sql: out, params: {} };
}

export function concatChSql(sep: string, ...args: (ChSql | ChSql[])[]): ChSql {
  return args.reduce(
    (acc: ChSql, arg) => {
      if (Array.isArray(arg)) {
        const joined = arg
          .map(a => a.sql)
          .filter(Boolean)
          .join(sep);
        if (joined) acc.sql += (acc.sql ? sep : '') + joined;
      } else if (arg.sql.length > 0) {
        acc.sql += `${acc.sql ? sep : ''}${arg.sql}`;
      }
      return acc;
    },
    { sql: '', params: {} },
  );
}

export function tableExpr({
  database,
  table,
}: {
  database: string;
  table: string;
}): ChSql {
  return { sql: `\`${database}\`.\`${table}\``, params: {} };
}

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

// Stub for the pre-Berg ClickHouse client base type. Pure type-only
// reference so Metadata's `client?: BaseClickhouseClient` field still
// type-checks. Berg's metadata never instantiates it.
export type BaseClickhouseClient = {
  query: <Format = unknown>(
    ...args: any[]
  ) => Promise<{
    json: <T = unknown>() => Promise<{
      data: T[];
      meta?: { name: string; type: string }[];
      rows?: number;
      statistics?: any;
    }>;
  }>;
  getMaxRowReadSetting?: () => Promise<number | undefined>;
  setMaxRowReadOnly?: (maxRowReadOnly: boolean) => void;
  testChartConfigValidity?: (...args: any[]) => Promise<any>;
  setQueryTimeout?: (timeout: number) => void;
};
