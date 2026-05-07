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
 * Convert Athena's `YYYY-MM-DD HH:MM:SS(.fff)` timestamp form (or a bare
 * `YYYY-MM-DD` date) into an ISO-8601 string with an explicit `Z` suffix.
 * Values that already carry a timezone (`Z`, `+05:30`, `-04:00`) are
 * returned unchanged so we never double-stamp.
 */
function normaliseAthenaTimestamp(raw: string): string {
  if (/[zZ]$|[+-]\d{2}:?\d{2}$/.test(raw)) return raw;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return `${raw}T00:00:00Z`;
  if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}/.test(raw)) {
    return `${raw.replace(' ', 'T')}Z`;
  }
  return raw;
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
      // Athena returns timestamps as `YYYY-MM-DD HH:MM:SS(.fff)` with no
      // timezone marker. Trino's `timestamp` type is zone-naive but for
      // Iceberg / S3-Tables sources it represents UTC. JavaScript's
      // `new Date('2026-05-07 04:21:00.000')` parses such a value as
      // *local* time, which shifts every chart bucket by the user's
      // offset. Normalise to a proper ISO-8601 UTC string here so the
      // browser interprets it consistently regardless of locale.
      return normaliseAthenaTimestamp(raw);
    case 'array':
    case 'map':
    case 'row':
    case 'json':
      try {
        return JSON.parse(raw);
      } catch {
        // Athena's `GetQueryResults` returns array/row/map cells as the
        // Trino CLI display form, *not* JSON: `[a, b, c]`, `{key=val}`,
        // `(a, b)`. JSON.parse rejects these (string elements aren't
        // quoted, map separator is `=` not `:`).  For arrays of scalars
        // we hand back a real JS array so consumers like the filter-chip
        // builder can iterate it; map / row fall through to the raw
        // string (callers that need them can stringify-compare).
        if (jsType === 'array' && /^\s*\[.*\]\s*$/.test(raw)) {
          const inner = raw.trim().slice(1, -1).trim();
          if (inner.length === 0) return [];
          return inner.split(',').map(s => s.trim());
        }
        return raw;
      }
    case 'string':
    case 'unknown':
    default:
      return raw;
  }
}
