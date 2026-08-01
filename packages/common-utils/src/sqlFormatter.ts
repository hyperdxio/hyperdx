import { clickhouse, formatDialect } from 'sql-formatter';

/** Matches a call to an aggregate-combinator function (eg. `countIf(`,). */
const COMBINATOR_FUNCTION_CALL_PATTERN =
  /\b([A-Za-z_]\w*(?:If|Array|Map|State|Merge|ForEach|Distinct|OrDefault|OrNull|Resample))\s+\(/g;

/** Matches a call to a parametric aggregate function with optional combinator (eg. `quantileIf(0.5)(`). */
const PARAMETRIC_COMBINATOR_FUNCTION_CALL_PATTERN =
  /\b([A-Za-z_]\w*(?:If|Array|Map|State|Merge|ForEach|Distinct|OrDefault|OrNull|Resample))\(([^()]*)\)\s+\(/g;

/**
 * Formats a ClickHouse SQL string (or raw-SQL macro template) for display.
 *
 * On top of sql-formatter this:
 *  - treats `$__…` template macros as params so the formatter doesn't choke on
 *    them (a no-op for already-resolved SQL that contains no macros), and
 *    tightens the spacing it inserts after a macro name, so `$__name (` — which
 *    `parseMacroArgs` would reject — stays `$__name(`.
 *  - tightens the space sql-formatter inserts after aggregate-combinator
 *    functions (`countIf (…)` → `countIf(…)`), which it treats as bare
 *    identifiers.
 *
 * Throws if the SQL can't be parsed (callers that want resilience should catch).
 */
export function format(query: string): string {
  const formatted = formatDialect(query, {
    dialect: clickhouse,
    // sql-formatter can't parse $__macros, so treat them as params.
    paramTypes: { custom: [{ regex: String.raw`\$__\w+` }] },
  });

  return (
    formatted
      // Remove any spaces inserted between a macro name and its opening paren, so `$__name (` → `$__name(`.
      .replace(/\$__(\w+)\s+\(/g, (_m, name) => `$__${name}(`)
      // Remove spaces between function names and their parentheses, eg. `countIf (...)` -> `countIf(...)`
      .replace(COMBINATOR_FUNCTION_CALL_PATTERN, (_m, name) => `${name}(`)
      // Remove spaces between parametric function names and their parentheses, eg. `countIf (...)` -> `countIf(...)`
      .replace(
        PARAMETRIC_COMBINATOR_FUNCTION_CALL_PATTERN,
        (_m, name, params) => `${name}(${params})(`,
      )
  );
}
