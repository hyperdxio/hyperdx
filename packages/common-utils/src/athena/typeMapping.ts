/**
 * Maps a raw Trino/Athena type string (e.g. "varchar", "decimal(10,2)",
 * "array(varchar)") to a coarse JS type label that downstream code can use
 * to decide rendering / parsing strategy.  Unknown types fall back to
 * `'unknown'`; consumers should treat that as "render as raw string".
 */

export type AthenaJsType =
  | 'string'
  | 'number'
  | 'boolean'
  | 'date'
  | 'array'
  | 'map'
  | 'row'
  | 'json'
  | 'unknown';

export function convertTrinoTypeToJsType(trinoType: string): AthenaJsType {
  const t = trinoType.trim().toLowerCase();
  if (t.startsWith('varchar') || t.startsWith('char')) return 'string';
  if (
    t.startsWith('tinyint') ||
    t.startsWith('smallint') ||
    t.startsWith('integer') ||
    t.startsWith('int') ||
    t.startsWith('bigint') ||
    t.startsWith('real') ||
    t.startsWith('double') ||
    t.startsWith('decimal')
  ) {
    return 'number';
  }
  if (t === 'boolean') return 'boolean';
  if (t.startsWith('date') || t.startsWith('time') || t.startsWith('timestamp'))
    return 'date';
  if (t.startsWith('array')) return 'array';
  if (t.startsWith('map')) return 'map';
  if (t.startsWith('row')) return 'row';
  if (t === 'json') return 'json';
  return 'unknown';
}

/**
 * Convert a raw cell value string from `GetQueryResultsCommand` to its JS
 * representation based on the column's mapped JS type.  Returns `null` when
 * the raw value is `null` / `undefined` (Athena reports `null` cells as a
 * missing `VarCharValue`).
 */
export function convertCellValue(
  raw: string | null | undefined,
  jsType: AthenaJsType,
): unknown {
  if (raw == null) return null;
  switch (jsType) {
    case 'number':
      return Number(raw);
    case 'boolean':
      return raw === 'true';
    case 'date':
      // ISO string; consumers convert to Date if needed
      return raw;
    case 'array':
    case 'map':
    case 'row':
    case 'json':
      try {
        return JSON.parse(raw);
      } catch {
        return raw;
      }
    case 'string':
    case 'unknown':
    default:
      return raw;
  }
}
