/**
 * Local replacements for the deleted `@berg/common-utils/dist/clickhouse`
 * shim. Berg's data layer is Athena/Trino, but a handful of app-side
 * helpers still consume the legacy ClickHouse-flavoured type names
 * (JSDataType, ColumnMeta, ChSql, ResponseJSON, …).
 *
 * These types are nominal — no runtime dependency on @clickhouse/client-*
 * — and exist purely to keep the chart/table components compiling
 * during the Phase 1.2 sweep. Once those components are fully ported to
 * the Berg /v1/query response shape they can be deleted.
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

export type ColumnMetaType = { name: string; type: string };

export type ColumnMeta = {
  codec_expression: string;
  comment: string;
  default_expression: string;
  default_type: string;
  name: string;
  ttl_expression: string;
  type: string;
};

export type ResponseJSON<
  T extends Record<string, unknown> = Record<string, unknown>,
> = {
  meta?: { name: string; type: string }[];
  data: T[];
  rows: number;
  statistics?: {
    elapsed: number;
    rows_read: number;
    bytes_read: number;
  };
};

export type ChSql = { sql: string; params: Record<string, any> };

/**
 * Stubbed client class. Berg routes chart-config queries through the Athena
 * /v1/query endpoint via `useClickhouseClient`. The class survives only as a
 * nominal type for the few hook signatures that reference it; runtime
 * behaviour is implemented in `app/src/clickhouse.ts`.
 */
type ClickhouseRowReader = {
  read: () => Promise<{ done: boolean; value?: any }>;
};

export type ClickhouseClient = {
  queryChartConfig: (args: {
    config: any;
    metadata: any;
    opts?: any;
    querySettings?: any;
  }) => Promise<ResponseJSON>;
  query: <Format>(args: {
    query: string;
    query_params?: Record<string, any>;
    format?: Format;
    abort_signal?: AbortSignal;
    connectionId?: string;
    clickhouse_settings?: Record<string, any>;
  }) => Promise<{
    json: <T extends Record<string, unknown>>() => Promise<ResponseJSON<T>>;
    stream: () => { getReader: () => ClickhouseRowReader };
  }>;
};

/**
 * Berg-side replacement for the deleted ClickHouseQueryError. The chart
 * renderer's error fallback uses `instanceof ClickHouseQueryError`
 * checks; surface the error class name so those branches still
 * type-narrow.
 */
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
 * Loose type-classifier used by the chart renderers. Maps Athena/Trino
 * type names plus the legacy ClickHouse type names back to a JSDataType
 * bucket. Older callers passed CH names; Berg's /v1/query response
 * carries Trino names; this helper accepts both.
 */
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

export function isJSDataTypeJSONStringifiable(
  dataType: JSDataType | null | undefined,
) {
  return (
    dataType === JSDataType.Map ||
    dataType === JSDataType.Array ||
    dataType === JSDataType.JSON ||
    dataType === JSDataType.Tuple ||
    dataType === JSDataType.Dynamic
  );
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

export function convertCHTypeToLuceneSearchType(dataType: string): {
  type: JSDataType | null;
  isArray: boolean;
} {
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

export function inferTimestampColumn(meta: Array<ColumnMetaType>) {
  return filterColumnMetaByType(meta, [JSDataType.Date])?.[0];
}

export function inferNumericColumn(meta: Array<ColumnMetaType>) {
  return filterColumnMetaByType(meta, [JSDataType.Number]);
}

/**
 * Parse the rendered SQL's SELECT list and build a map of
 * `{ alias: original-expression }` for every `<expr> AS <alias>` pair.
 *
 * Used by the row-table to translate row-WHERE clauses for user-typed
 * SELECT expressions back into something Trino can resolve against the
 * underlying table.  Without this, expanding a row whose query SELECTed
 * `JSON_PARSE(payload) AS parsed_payload` would emit
 * `WHERE parsed_payload = …` — but `parsed_payload` is a result-set
 * alias, not a real column, and Trino raises COLUMN_NOT_FOUND.  With the
 * map, the WHERE clause uses the original `JSON_PARSE(payload)` form
 * which is always resolvable.
 *
 * The parser is intentionally minimal:
 *   - Locates the SELECT segment between `SELECT` and the first
 *     top-level `FROM` (paren/quote-aware).
 *   - Splits the SELECT list on top-level commas.
 *   - Per entry, looks for a top-level ` AS ` (case-insensitive) and
 *     captures everything before it as the expression, everything after
 *     as the alias (with surrounding double-quotes / backticks stripped).
 *   - Does NOT try to handle implicit aliases (`expr alias` without AS),
 *     CTE bodies, or window-frame `AS` keywords — those don't appear in
 *     the chart-config-emitted SELECT today.
 */
export function chSqlToAliasMap(
  sql: { sql: string; params: Record<string, any> } | undefined,
): Record<string, string> {
  if (!sql?.sql) return {};
  const text = sql.sql;

  // Find the first top-level `SELECT` and the matching `FROM`.  We
  // skip nested SELECTs (parenthesised subqueries) and quoted strings.
  const lower = text.toLowerCase();
  const findTopLevelKeyword = (start: number, kw: string): number => {
    const lkw = kw.toLowerCase();
    let depth = 0;
    let inSingle = false;
    let inDouble = false;
    let inBacktick = false;
    for (let i = start; i < text.length; i++) {
      const ch = text[i];
      if (!inSingle && !inDouble && !inBacktick) {
        if (ch === '(') depth++;
        else if (ch === ')') depth--;
      }
      if (!inDouble && !inBacktick && ch === "'") inSingle = !inSingle;
      else if (!inSingle && !inBacktick && ch === '"') inDouble = !inDouble;
      else if (!inSingle && !inDouble && ch === '`') inBacktick = !inBacktick;
      if (
        depth === 0 &&
        !inSingle &&
        !inDouble &&
        !inBacktick &&
        lower.slice(i, i + lkw.length) === lkw &&
        // Word boundaries on both sides.
        (i === 0 || /\W/.test(text[i - 1])) &&
        (i + lkw.length === text.length || /\W/.test(text[i + lkw.length]))
      ) {
        return i;
      }
    }
    return -1;
  };

  const selectIdx = findTopLevelKeyword(0, 'SELECT');
  if (selectIdx === -1) return {};
  const fromIdx = findTopLevelKeyword(selectIdx + 'SELECT'.length, 'FROM');
  if (fromIdx === -1) return {};

  const list = text.slice(selectIdx + 'SELECT'.length, fromIdx);

  // Top-level comma split, paren/quote aware.
  const entries: string[] = [];
  {
    let depth = 0;
    let inSingle = false;
    let inDouble = false;
    let inBacktick = false;
    let current = '';
    for (let i = 0; i < list.length; i++) {
      const ch = list[i];
      if (!inSingle && !inDouble && !inBacktick) {
        if (ch === '(') depth++;
        else if (ch === ')') depth--;
      }
      if (!inDouble && !inBacktick && ch === "'") inSingle = !inSingle;
      else if (!inSingle && !inBacktick && ch === '"') inDouble = !inDouble;
      else if (!inSingle && !inDouble && ch === '`') inBacktick = !inBacktick;
      if (depth === 0 && !inSingle && !inDouble && !inBacktick && ch === ',') {
        entries.push(current);
        current = '';
      } else {
        current += ch;
      }
    }
    if (current.trim()) entries.push(current);
  }

  const map: Record<string, string> = {};
  for (const raw of entries) {
    const part = raw.trim();
    if (!part) continue;
    // Locate top-level ` AS ` (case-insensitive).
    let depth = 0;
    let inSingle = false;
    let inDouble = false;
    let inBacktick = false;
    let asIdx = -1;
    for (let i = 0; i < part.length - 2; i++) {
      const ch = part[i];
      if (!inSingle && !inDouble && !inBacktick) {
        if (ch === '(') depth++;
        else if (ch === ')') depth--;
      }
      if (!inDouble && !inBacktick && ch === "'") inSingle = !inSingle;
      else if (!inSingle && !inBacktick && ch === '"') inDouble = !inDouble;
      else if (!inSingle && !inDouble && ch === '`') inBacktick = !inBacktick;
      if (
        depth === 0 &&
        !inSingle &&
        !inDouble &&
        !inBacktick &&
        /\s/.test(ch) &&
        part.slice(i + 1, i + 3).toLowerCase() === 'as' &&
        i + 3 < part.length &&
        /\s/.test(part[i + 3])
      ) {
        asIdx = i;
        break;
      }
    }
    if (asIdx === -1) continue;
    const expr = part.slice(0, asIdx).trim();
    let alias = part.slice(asIdx + 4).trim();
    // Strip the surrounding identifier quote, if any.
    if (
      (alias.startsWith('"') && alias.endsWith('"')) ||
      (alias.startsWith('`') && alias.endsWith('`'))
    ) {
      alias = alias.slice(1, -1);
    }
    if (alias && expr) map[alias] = expr;
  }

  return map;
}

/**
 * Lightweight column-reference extraction for primary-key / partition-key
 * expressions. Splits on commas (respecting parenthesis nesting) and
 * pulls out top-level identifiers. Adequate for the row-table's needs;
 * doesn't try to handle full SQL.
 */
export function extractColumnReferencesFromKey(expr: string): string[] {
  if (!expr) return [];
  const parts: string[] = [];
  let depth = 0;
  let current = '';
  for (const ch of expr) {
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    if (ch === ',' && depth === 0) {
      parts.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  if (current.trim()) parts.push(current.trim());

  const refs = new Set<string>();
  for (const part of parts) {
    // map[`key`] / map['key'] — keep verbatim
    const mapAccessRegex =
      /\b[a-zA-Z_][a-zA-Z0-9_]*\[(?:\d+|'[^']*'|`[^`]*`)\]/g;
    const mapAccesses = part.match(mapAccessRegex) ?? [];
    for (const m of mapAccesses) refs.add(m);
    let stripped = part.replace(mapAccessRegex, '');

    // JSON paths (foo.bar.baz) — keep the whole dotted path
    const jsonPathRegex =
      /\b[a-zA-Z_][a-zA-Z0-9_]*(?:\.[a-zA-Z_][a-zA-Z0-9_]*)+/g;
    const jsonPaths = stripped.match(jsonPathRegex) ?? [];
    for (const j of jsonPaths) refs.add(j);
    stripped = stripped.replace(jsonPathRegex, '');

    // Bare identifiers (skip SQL function calls — anything followed by `(`)
    const identRegex = /\b[a-zA-Z_][a-zA-Z0-9_]*\b/g;
    const idents = stripped.match(identRegex) ?? [];
    const reservedFns = new Set([
      'toStartOfInterval',
      'toIntervalDay',
      'toIntervalHour',
      'toIntervalMinute',
      'toIntervalSecond',
      'date_trunc',
      'cityHash64',
      'sipHash64',
    ]);
    for (const ident of idents) {
      if (reservedFns.has(ident)) continue;
      // Skip if followed by `(`
      const idx = stripped.indexOf(ident);
      const next = stripped.slice(idx + ident.length).trimStart();
      if (next.startsWith('(')) continue;
      refs.add(ident);
    }
  }
  return Array.from(refs);
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
