import * as SQLParser from 'node-sql-parser';

import { escapeSqlString, replaceJsonExpressions } from '@/core/utils';
import { parse } from '@/queryParser';
import {
  ChartVariable,
  DASHBOARD_VARIABLE_NAME_MAX_LENGTH,
  DASHBOARD_VARIABLE_NAME_PATTERN_ANCHORED,
  DashboardFilter,
  DashboardFilterValue,
  Filter,
} from '@/types';
import { getVariableReferences, substituteVariables } from '@/variables';

export type FilterState = {
  [key: string]: {
    included: Set<string | boolean>;
    excluded: Set<string | boolean>;
    range?: { min: number; max: number }; // For BETWEEN conditions
  };
};

// Wrap a quoted string literal in a ClickHouse expression whose result type
// matches the date column's type.
const dateTimeValueExpr = (chType: string, quotedValue: string): string => {
  const dt64 = chType.match(/DateTime64\((\d+)/);

  if (dt64) {
    return `parseDateTime64BestEffort(${quotedValue}, ${dt64[1]})`;
  }

  if (/\bDateTime\b/.test(chType)) {
    return `parseDateTimeBestEffort(${quotedValue})`;
  }

  if (/\bDate32\b/.test(chType)) {
    return `toDate32(${quotedValue})`;
  }

  if (/\bDate\b/.test(chType)) {
    return `toDate(${quotedValue})`;
  }

  // Fallback for an unexpected type; DateTime64(9) covers the widest range.
  return `parseDateTime64BestEffort(${quotedValue}, 9)`;
};

export const filtersToQuery = (
  filters: FilterState,
  {
    stringifyKeys = false,
    dateTimeColumns,
  }: {
    stringifyKeys?: boolean;
    /** Map of DateTime/Date column name → its ClickHouse type. */
    dateTimeColumns?: ReadonlyMap<string, string>;
  } = {},
): Filter[] => {
  return Object.entries(filters)
    .filter(
      ([_, values]) =>
        values.included.size > 0 ||
        values.excluded.size > 0 ||
        values.range != null,
    )
    .flatMap(([key, values]) => {
      const conditions: Filter[] = [];
      const actualKey = stringifyKeys ? `toString(${key})` : key;

      // DateTime/DateTime64 columns can't be compared against a bare string
      // literal in ClickHouse, so wrap each value in a parse/convert expression whose
      // result type matches the column type.
      const chType = stringifyKeys ? undefined : dateTimeColumns?.get(key);
      const formatValue = (v: string | boolean): string | boolean =>
        typeof v !== 'string'
          ? v
          : chType != null
            ? dateTimeValueExpr(chType, `'${escapeSqlString(v)}'`)
            : `'${escapeSqlString(v)}'`;

      if (values.included.size > 0) {
        conditions.push({
          type: 'sql' as const,
          condition: `${actualKey} IN (${Array.from(values.included)
            .map(formatValue)
            .join(', ')})`,
        });
      }
      if (values.excluded.size > 0) {
        conditions.push({
          type: 'sql' as const,
          condition: `${actualKey} NOT IN (${Array.from(values.excluded)
            .map(formatValue)
            .join(', ')})`,
        });
      }
      if (values.range != null) {
        conditions.push({
          type: 'sql' as const,
          condition: `${actualKey} BETWEEN ${values.range.min} AND ${values.range.max}`,
        });
      }
      return conditions;
    });
};

/**
 * Render a FilterState as a single AND-joined SQL predicate, remapping every
 * key through `renderKey` first.
 *
 * Callers that also emit the same keys elsewhere in the query (e.g. inside a
 * SELECT aggregate) must render both halves the same way, or the predicate
 * silently addresses a different expression than the one being aggregated.
 * `stringifyKeys` is deliberately false: a rendered JSON path already carries
 * the `.:String` type suffix, so it needs no `toString()` wrapper.
 *
 * Returns undefined when nothing is selected, so callers can branch on
 * "constrained vs unconstrained" without inspecting the string.
 */
export const filterStateToPredicate = (
  state: FilterState,
  renderKey: (rawKey: string) => string,
): string | undefined => {
  const rendered: FilterState = {};
  for (const [rawKey, selection] of Object.entries(state)) {
    rendered[renderKey(rawKey)] = selection;
  }
  const conditions = filtersToQuery(rendered).flatMap(f =>
    // filtersToQuery only emits `sql` filters (which carry `condition`); the
    // `in` guard narrows away the `sql_ast` member of the Filter union.
    'condition' in f ? [f.condition] : [],
  );
  return conditions.length
    ? conditions.map(c => `(${c})`).join(' AND ')
    : undefined;
};

/**
 * Stable, JSON-safe projection of a FilterState, for use in react-query keys.
 *
 * A raw FilterState cannot be used as a query key: its selections are `Set`s,
 * and TanStack Query hashes keys with JSON.stringify, which serializes any Set
 * to `{}` — so every distinct selection would collide on one cache entry.
 * Keys and members are sorted so that insertion order alone never produces a
 * spurious cache miss.
 */
export const serializeFilterState = (state: FilterState): string => {
  const sortMembers = (values: Set<string | boolean>) =>
    Array.from(values).map(String).sort();
  return JSON.stringify(
    Object.entries(state)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, { included, excluded, range }]) => [
        key,
        sortMembers(included),
        sortMembers(excluded),
        range ?? null,
      ]),
  );
};

// Helper function to parse a string value as boolean if possible, or otherwise
// return as string with surrounding quotes removed and SQL-escaped quotes unescaped.
const getBooleanOrUnquotedString = (value: string): string | boolean => {
  const trimmed = value.trim();

  if (['true', 'false'].includes(trimmed.toLowerCase())) {
    return trimmed.toLowerCase() === 'true';
  }

  // Remove surrounding quotes and reverse the escape sequences produced by
  // filtersToQuery's escapeSqlString. Order matters: collapse \\ → \ first so
  // that the following '' → ' pass doesn't mistake content for an escape.
  if (trimmed.startsWith("'") && trimmed.endsWith("'")) {
    return trimmed.slice(1, -1).replace(/\\\\/g, '\\').replace(/''/g, "'");
  }
  return trimmed;
};

// Returns true when the single-quote at position `i` is a real string delimiter
// rather than an escape sequence.  Handles both ClickHouse/SQL '' escaping and
// backslash \' escaping.  An odd number of preceding backslashes means the
// quote is escaped via \'; an even number (including zero) means the
// backslashes are themselves escaped (\\) and the quote is a real boundary.
function isQuoteBoundary(s: string, i: number): boolean {
  if (s[i] !== "'") return false;
  let backslashes = 0;
  for (let j = i - 1; j >= 0 && s[j] === '\\'; j--) {
    backslashes++;
  }
  return backslashes % 2 === 0;
}

// If we're inside a quoted string and hit a quote, check whether the next
// character is also a quote ('' escape).  If so, skip both and stay in the
// string.  Returns the new index to continue iteration from.
function handleQuoteEscape(
  s: string,
  i: number,
): { skip: boolean; next: number } {
  if (i + 1 < s.length && s[i + 1] === "'") {
    return { skip: true, next: i + 1 };
  }
  return { skip: false, next: i };
}

// Helper function to split on commas while respecting quoted strings and booleans.
// Handles SQL-escaped single quotes ('') inside quoted strings.
function splitValuesOnComma(valuesStr: string): (string | boolean)[] {
  const values: (string | boolean)[] = [];
  let currentValue = '';
  let inString = false;

  for (let i = 0; i < valuesStr.length; i++) {
    const char = valuesStr[i];

    if (isQuoteBoundary(valuesStr, i)) {
      if (inString) {
        const esc = handleQuoteEscape(valuesStr, i);
        if (esc.skip) {
          currentValue += "''";
          i = esc.next;
          continue;
        }
      }
      inString = !inString;
      currentValue += char;
      continue;
    }

    if (!inString && char === ',') {
      if (currentValue.trim()) {
        values.push(getBooleanOrUnquotedString(currentValue));
      }
      currentValue = '';
      continue;
    }

    currentValue += char;
  }

  // Add the last value
  if (currentValue.trim()) {
    values.push(getBooleanOrUnquotedString(currentValue));
  }

  return values;
}

// Check whether a SQL fragment contains a keyword or operator at the *top
// level* — outside single-quoted strings and outside any parentheses.  Accepts
// either single characters (=, <, >) or multi-character keywords (' OR ',
// ' BETWEEN ') to search for.
//
// Parenthesis-depth awareness is what lets a complex expression key survive
// parsing: in `if(SeverityText = 'error' OR SeverityText = 'fatal', ...) IN
// ('Errors')` the `=` and ` OR ` live inside the `if(...)` sub-expression, so
// they must not be mistaken for top-level operators that would disqualify the
// clause. Parentheses inside quoted strings don't affect depth.
function containsOutsideQuotes(
  text: string,
  targets: (string | { char: string })[],
): boolean {
  let inString = false;
  let depth = 0;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (isQuoteBoundary(text, i)) {
      if (inString) {
        const esc = handleQuoteEscape(text, i);
        if (esc.skip) {
          i = esc.next;
          continue;
        }
      }
      inString = !inString;
      continue;
    }
    if (inString) continue;

    if (char === '(') {
      depth++;
      continue;
    }
    if (char === ')') {
      if (depth > 0) depth--;
      continue;
    }
    if (depth > 0) continue;

    for (const target of targets) {
      if (typeof target === 'object') {
        if (char === target.char) return true;
      } else {
        if (text.slice(i, i + target.length).toUpperCase() === target)
          return true;
      }
    }
  }
  return false;
}

function containsOperatorOutsideQuotes(part: string): boolean {
  return containsOutsideQuotes(part, [
    { char: '=' },
    { char: '<' },
    { char: '>' },
    ' OR ',
  ]);
}

// Split a string on the first occurrence of `delimiter` that is at the top
// level — outside single-quoted strings and outside any parentheses.  Returns
// [before, after] or null if not found.
//
// Depth awareness makes the split land on the separator between the key
// expression and its value list rather than on an operator nested inside the
// key: `if(SeverityText IN ('error','fatal'), ...) IN ('Errors')` must split on
// the outer ` IN `, keeping the whole `if(...)` as the key, not on the ` IN `
// inside the `if(...)`.
function splitOnFirstOutsideQuotes(
  text: string,
  delimiter: string,
): [string, string] | null {
  let inString = false;
  let depth = 0;
  const upper = delimiter.toUpperCase();
  for (let i = 0; i < text.length; i++) {
    const char = text.charAt(i);
    if (isQuoteBoundary(text, i)) {
      if (inString) {
        const esc = handleQuoteEscape(text, i);
        if (esc.skip) {
          i = esc.next;
          continue;
        }
      }
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (char === '(') {
      depth++;
      continue;
    }
    if (char === ')') {
      if (depth > 0) depth--;
      continue;
    }
    if (depth > 0) continue;
    if (text.slice(i, i + upper.length).toUpperCase() === upper) {
      return [text.slice(0, i), text.slice(i + upper.length)];
    }
  }
  return null;
}

// Helper function to extract simple IN/NOT IN clauses from a condition
// This handles both simple conditions and compound conditions with AND
function extractInClauses(condition: string): Array<{
  key: string;
  values: (string | boolean)[];
  isExclude: boolean;
}> {
  const results: Array<{
    key: string;
    values: (string | boolean)[];
    isExclude: boolean;
  }> = [];

  // Split on ' AND ' while respecting quoted strings (including SQL-escaped
  // quotes) and parenthesis depth. Only a *top-level* ` AND ` joins two
  // separate predicates; an ` AND ` nested inside parentheses belongs to a key
  // sub-expression (e.g. `if(x BETWEEN 1 AND 2, ...) IN (...)`) and must not
  // split the clause.
  const parts: string[] = [];
  let currentPart = '';
  let inString = false;
  let depth = 0;

  for (let i = 0; i < condition.length; i++) {
    const char = condition[i];

    if (isQuoteBoundary(condition, i)) {
      if (inString) {
        const esc = handleQuoteEscape(condition, i);
        if (esc.skip) {
          currentPart += "''";
          i = esc.next;
          continue;
        }
      }
      inString = !inString;
      currentPart += char;
      continue;
    }

    if (!inString) {
      if (char === '(') {
        depth++;
      } else if (char === ')') {
        if (depth > 0) depth--;
      } else if (
        depth === 0 &&
        condition.slice(i, i + 5).toUpperCase() === ' AND '
      ) {
        if (currentPart.trim()) {
          parts.push(currentPart.trim());
        }
        currentPart = '';
        i += 4; // Skip past ' AND '
        continue;
      }
    }

    currentPart += char;
  }

  if (currentPart.trim()) {
    parts.push(currentPart.trim());
  }

  // Process each part to extract IN/NOT IN clauses
  for (const part of parts) {
    // Skip parts that contain OR (not supported) or comparison operators,
    // but only when those operators appear at the top level — outside quoted
    // strings and outside any parentheses. Operators nested inside a key
    // expression's parentheses (e.g. `if(a = 'x' OR b = 'y', ...)`) are part of
    // that expression and must not disqualify the clause.
    if (containsOperatorOutsideQuotes(part)) {
      continue;
    }

    const isExclude = containsOutsideQuotes(part, [' NOT IN ']);
    const hasIn = isExclude || containsOutsideQuotes(part, [' IN ']);

    if (hasIn) {
      // Split on the first unquoted ' IN ' / ' NOT IN '
      const splitResult = splitOnFirstOutsideQuotes(
        part,
        isExclude ? ' NOT IN ' : ' IN ',
      );
      if (!splitResult) continue;
      const [key, values] = splitResult;

      const keyStr = key.trim();
      const trimmedValues = values.trim();
      const withoutParens =
        trimmedValues.startsWith('(') && trimmedValues.endsWith(')')
          ? trimmedValues.slice(1, -1)
          : trimmedValues;

      // Unwrap the date-value expressions filtersToQuery emits for date columns
      // back into the plain quoted literal 'X' before splitting on commas. The
      // DateTime64 wrapper contains an unquoted comma (before its precision
      // argument), so this must run before splitValuesOnComma. The capture
      // group `'(?:[^']|'')*'` consumes the SQL-escaped quoted string ('' for
      // embedded quotes), keeping the round-trip exact even if a value
      // contained quotes; the optional `, N` covers parseDateTime64BestEffort's
      // precision argument. Matches the four producers in `dateTimeValueExpr`:
      // parseDateTime64BestEffort, parseDateTimeBestEffort, toDate32, toDate.
      const unwrapped = withoutParens.replace(
        /(?:parseDateTime64BestEffort|parseDateTimeBestEffort|toDate32|toDate)\(('(?:[^']|'')*')(?:\s*,\s*\d+)?\)/g,
        '$1',
      );

      const valuesArray = splitValuesOnComma(unwrapped);

      results.push({
        key: keyStr,
        values: valuesArray,
        isExclude,
      });
    }
  }

  return results;
}

export const parseQuery = (
  q: Filter[],
): {
  filters: FilterState;
} => {
  const state = new Map<
    string,
    {
      included: Set<string | boolean>;
      excluded: Set<string | boolean>;
      range?: { min: number; max: number };
    }
  >();
  for (const filter of q) {
    if (filter.type !== 'sql') continue;

    // Check for BETWEEN condition (only when BETWEEN appears outside quotes)
    if (containsOutsideQuotes(filter.condition, [' BETWEEN '])) {
      const betweenMatch = filter.condition.match(
        /^(.+?)\s+BETWEEN\s+(.+?)\s+AND\s+(.+?)$/i,
      );
      if (betweenMatch) {
        const [, key, minVal, maxVal] = betweenMatch;
        const keyStr = key.trim();
        // Use `Number` (not `parseFloat`) so both bounds must be *entirely*
        // numeric. This rejects quoted/date operands (`'2024-01-01'` → NaN) and
        // trailing content the greedy regex may have swallowed from a compound
        // condition (`... AND 2 AND other IN ('x')` → NaN), rather than
        // emitting a `BETWEEN NaN AND NaN` range. A non-numeric BETWEEN
        // contributes nothing (the sidebar range facet only handles numbers).
        const min = Number(minVal.trim());
        const max = Number(maxVal.trim());

        if (Number.isFinite(min) && Number.isFinite(max)) {
          if (!state.has(keyStr)) {
            state.set(keyStr, {
              included: new Set(),
              excluded: new Set(),
              range: { min, max },
            });
          } else {
            const existing = state.get(keyStr)!;
            existing.range = { min, max };
          }
        }
        continue;
      }
    }

    // Extract all simple IN/NOT IN clauses from the condition
    // This handles both simple conditions and compound conditions with AND/OR
    const inClauses = extractInClauses(filter.condition);

    for (const clause of inClauses) {
      if (!state.has(clause.key)) {
        state.set(clause.key, { included: new Set(), excluded: new Set() });
      }
      const sets = state.get(clause.key)!;
      clause.values.forEach(v => {
        if (clause.isExclude) {
          sets.excluded.add(v);
        } else {
          sets.included.add(v);
        }
      });
    }
  }
  return { filters: Object.fromEntries(state) };
};

// Count top-level ` AND ` separators (outside quoted strings and outside any
// parentheses). Used to detect conjuncts the pinned-filter parser silently
// drops. An ` AND ` nested inside parentheses belongs to a key sub-expression
// and is not a top-level conjunct.
function countTopLevelAnd(condition: string): number {
  let count = 0;
  let inString = false;
  let depth = 0;
  for (let i = 0; i < condition.length; i++) {
    const char = condition.charAt(i);
    if (isQuoteBoundary(condition, i)) {
      if (inString) {
        const esc = handleQuoteEscape(condition, i);
        if (esc.skip) {
          i = esc.next;
          continue;
        }
      }
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (char === '(') {
      depth++;
      continue;
    }
    if (char === ')') {
      if (depth > 0) depth--;
      continue;
    }
    if (depth > 0) continue;
    if (condition.slice(i, i + 5).toUpperCase() === ' AND ') {
      count++;
      i += 4;
    }
  }
  return count;
}

/**
 * Whether a filter renders *fully* as a single facet in the search sidebar.
 *
 * The sidebar only reads `type: 'sql'` conditions in the exact pinned-filter
 * form filtersToQuery produces — a single `<col> IN (...)`, `<col> NOT IN (...)`,
 * or `<col> BETWEEN <min> AND <max>` predicate. `parseQuery` is deliberately
 * lenient (it extracts what it can and ignores the rest), so "parses to a
 * non-empty state" is *not* enough: `col IN ('x') AND foo = 1` would render the
 * `IN` facet while still executing `AND foo = 1` at query time, so the displayed
 * and executed filters diverge.
 *
 * A filter is accepted iff it round-trips to exactly one clause on exactly one
 * column with no dropped conjuncts:
 *  - `parseQuery` yields exactly one column,
 *  - re-emitting that state via `filtersToQuery` yields exactly one clause, and
 *  - the input has no extra top-level `AND` beyond the one a `BETWEEN` carries.
 *
 * Used by the external saved-search API to reject filters that would be stored
 * and executed but not shown (or only partially shown) in the UI.
 */
export function isRenderablePinnedFilter(filter: Filter): boolean {
  if (filter.type === 'sql_ast') return false;

  const state = parseQuery([filter]).filters;
  const keys = Object.keys(state);
  if (keys.length !== 1) return false;

  // A pinned-filter column key is a bare column expression. parseQuery's lenient
  // key capture can fold a boolean/negation operator into the key — e.g.
  // `col NOT BETWEEN 1 AND 2` parses to key `col NOT`, and `NOT (col IN (...))`
  // to key `NOT (col`. Both pass the clause/AND-count checks below, but the
  // executed predicate is the *inverse* of the facet the sidebar renders from
  // the same parse, so displayed and executed filters diverge. A real column key
  // never contains a bare NOT/AND/OR keyword, so reject when one appears.
  if (/\b(?:NOT|AND|OR)\b/i.test(keys[0])) return false;

  // filtersToQuery emits one clause per (column, kind); >1 means the condition
  // resolved to multiple predicates (e.g. included + excluded on one column, or
  // a compound), which is not a single renderable facet.
  if (filtersToQuery(state).length !== 1) return false;

  // Catch conjuncts the parser dropped: a single IN/NOT IN has no top-level
  // AND, a single BETWEEN has exactly one (its own `min AND max`).
  const expectedAnds = state[keys[0]].range ? 1 : 0;
  return countTopLevelAnd(filter.condition) === expectedAnds;
}

export type SavedFilterValueIssue = {
  /** Index of the offending value within the input array */
  index: number;
  /** Query language the condition claims to be written in */
  language: 'lucene' | 'sql';
  /** The raw condition string that failed to parse */
  condition: string;
};

const isParseableLucene = (condition: string): boolean => {
  try {
    parse(condition);
    return true;
  } catch {
    return false;
  }
};

// node-sql-parser can't handle ClickHouse map / array access (e.g.
// `LogAttributes['k']` or `arr[1]`), so swap those out for harmless literals
// before parsing — we only care whether the predicate is structurally valid.
const MAP_OR_ARRAY_ACCESS_REGEX = /\b[a-zA-Z0-9_]+\[([0-9]+|'[^']*')\]/g;

const isParseableSql = (condition: string): boolean => {
  try {
    const { sqlWithReplacements } = replaceJsonExpressions(condition);
    const sanitized = sqlWithReplacements.replace(
      MAP_OR_ARRAY_ACCESS_REGEX,
      "''",
    );
    new SQLParser.Parser().astify(`SELECT 1 FROM t WHERE ${sanitized}`, {
      database: 'Postgresql',
    });
    return true;
  } catch {
    return false;
  }
};

/**
 * Whether a condition string parses as the given query language. Empty /
 * whitespace-only conditions are considered valid (they're no-ops, not errors).
 * `promql` is not statically validated here and is treated as valid.
 */
export function isValidFilterCondition(
  condition: string,
  language: 'lucene' | 'sql' | 'promql',
): boolean {
  if (!condition.trim()) return true;
  if (language === 'lucene') return isParseableLucene(condition);
  if (language === 'sql') return isParseableSql(condition);
  return true;
}

/**
 * Validate the condition strings carried in a dashboard's saved filter values.
 *
 * Schema validation only guarantees each value has a `{ type, condition }`
 * shape — the condition text itself is a free-form string and may be broken in
 * a hand-edited or machine-generated export. This returns one issue per value
 * whose condition fails to parse as the language it claims to be, so callers
 * can warn the user (e.g. on import) without hard-blocking the operation.
 *
 * Empty / whitespace-only conditions are treated as valid (they're no-ops at
 * query time, not errors), as are structurally-validated `sql_ast` filters.
 * Variable-keyed entries carry no condition text at all, so there is nothing to
 * validate and they are skipped by the same `type` guard.
 */
export function validateSavedFilterValues(
  filters: DashboardFilterValue[],
): SavedFilterValueIssue[] {
  const issues: SavedFilterValueIssue[] = [];
  filters.forEach((filter, index) => {
    if (filter.type !== 'lucene' && filter.type !== 'sql') return;
    const condition = filter.condition;
    if (!condition.trim()) return;
    if (!isValidFilterCondition(condition, filter.type)) {
      issues.push({ index, language: filter.type, condition });
    }
  });
  return issues;
}

export type SavedQueryIssue = {
  /** Query language the saved query claims to be written in */
  language: 'lucene' | 'sql';
  /** The raw saved query string that failed to parse */
  query: string;
};

/**
 * Validate a dashboard's default saved query (the `where` clause applied to the
 * whole dashboard). Like the other import-time validators this only checks that
 * the query *parses* as its declared language. Returns a single issue or `null`.
 *
 * Empty / whitespace-only queries are treated as valid (no-ops), and a query in
 * a non-statically-validated language (`promql`) is treated as valid. A missing
 * language defaults to `lucene`, mirroring how the dashboard page resolves it.
 *
 * A malformed saved query is comparatively low impact at import time — it's
 * surfaced in the dashboard's search bar where the user can see and edit it —
 * but validating it keeps the import warnings consistent and avoids silently
 * carrying over a broken default query.
 */
export function validateSavedQuery(
  savedQuery: string | null | undefined,
  language: 'lucene' | 'sql' | 'promql' | null | undefined,
): SavedQueryIssue | null {
  if (!savedQuery?.trim()) return null;
  const lang = language ?? 'lucene';
  if (lang !== 'lucene' && lang !== 'sql') return null;
  if (isValidFilterCondition(savedQuery, lang)) return null;
  return { language: lang, query: savedQuery };
}

export type DashboardFilterQueryIssue = {
  /** ID of the offending dashboard filter */
  filterId: string;
  /** Display name of the offending dashboard filter */
  filterName: string;
  /** Query language of the filter's `where` clause */
  language: 'lucene' | 'sql';
  /** The raw `where` clause that failed to parse */
  where: string;
  /** Why it failed, when the clause itself parses but its variables don't resolve. */
  detail?: string;
};

/**
 * Validate the `where` clause of each dashboard filter *definition* (the query
 * that scopes which values populate the filter's dropdown).
 *
 * Useful at import time, where no values query is actually run: a filter whose
 * `where` clause is malformed would otherwise only surface as a failed query
 * after opening the dashboard. Returns one issue per filter whose `where`
 * fails to parse as its declared language.
 *
 * Variable references are expanded before the parse validation.
 *
 * Note: this only checks that the `where` clause *parses*. It cannot catch a
 * `where`/`expression` that references a non-existent column — that only fails
 * when the query runs against ClickHouse.
 */
export function validateDashboardFilterQueries(
  filters: DashboardFilter[],
): DashboardFilterQueryIssue[] {
  const issues: DashboardFilterQueryIssue[] = [];

  // Variables are expanded with an empty selection.
  const variables: ChartVariable[] = getDashboardVariableDeclarations(
    filters,
  ).map(declaration => ({ ...declaration, values: [] }));

  for (const filter of filters) {
    // Only ClickHouse-queried filters carry a values query to validate.
    if (!isQueryExpressionFilter(filter)) continue;
    const where = filter.where ?? '';
    if (!where.trim()) continue;
    const language = filter.whereLanguage ?? 'sql';
    if (language !== 'lucene' && language !== 'sql') continue;
    const resolved = resolveFilterValuesWhere(filter, variables);
    if (resolved.error) {
      issues.push({
        filterId: filter.id,
        filterName: filter.name,
        language,
        where,
        detail: resolved.error,
      });
    } else if (!isValidFilterCondition(resolved.where, language)) {
      issues.push({
        filterId: filter.id,
        filterName: filter.name,
        language,
        where,
      });
    }
  }
  return issues;
}

/** Derive the default `variableName` for a filter from its display name. */
export function deriveVariableName(filterName: string): string {
  const sanitized = filterName
    .trim()
    .replace(/\s+/g, '_')
    .replace(/[^A-Za-z0-9_]+/g, '');

  // Add a `v` prefix if the sanitized name starts with a number or underscore,
  // to ensure it is a valid variable name.
  return /^[0-9_]/.test(sanitized) ? `v${sanitized}` : sanitized;
}

/**
 * Whether a filter's selected value is applied as a condition on matching tiles.
 *
 * Missing means enabled: filters that predate the field must keep broadcasting.
 * Compared against `false` rather than defaulted with `??` because filters are
 * stored in an untyped Mongo array, so `null` is reachable.
 */
export function isFilterBroadcastEnabled(filter: {
  isBroadcastEnabled?: boolean;
}): boolean {
  return filter.isBroadcastEnabled !== false;
}

/** Whether a filter's selected value is exposed to tiles as a variable. */
export function isFilterVariableEnabled(filter: {
  isVariableEnabled?: boolean;
}): boolean {
  return filter.isVariableEnabled === true;
}

/** The discriminant every dashboard-filter shape carries. */
export type DashboardFilterKind = DashboardFilter['type'];

/** Type guard for QUERY_EXPRESSION type filters. */
export function isQueryExpressionFilter<
  T extends { type: DashboardFilterKind },
>(filter: T): filter is Extract<T, { type: 'QUERY_EXPRESSION' }> {
  return filter.type === 'QUERY_EXPRESSION';
}

/** Type guard for STATIC_LIST type filters. */
export function isStaticListFilter<T extends { type: DashboardFilterKind }>(
  filter: T,
): filter is Extract<T, { type: 'STATIC_LIST' }> {
  return filter.type === 'STATIC_LIST';
}

/** Type guard for PROMETHEUS_LABEL type filters. */
export function isPrometheusLabelFilter<
  T extends { type: DashboardFilterKind },
>(filter: T): filter is Extract<T, { type: 'PROMETHEUS_LABEL' }> {
  return filter.type === 'PROMETHEUS_LABEL';
}

/** The SQL expression associated with the filter, if any. */
export function getFilterExpression(
  filter: DashboardFilter,
): string | undefined {
  return isQueryExpressionFilter(filter) ? filter.expression : undefined;
}

/** What the filter broadcasts, or undefined when it cannot broadcast. */
export function getFilterBroadcastTarget(
  filter: DashboardFilter,
): { expression: string; appliesToSourceIds?: string[] } | undefined {
  if (!isQueryExpressionFilter(filter) || !isFilterBroadcastEnabled(filter))
    return undefined;
  return {
    expression: filter.expression,
    appliesToSourceIds: filter.appliesToSourceIds,
  };
}

/**
 * Whether a filter does anything at all with the value it collects — broadcast
 * it as a condition, expose it as `$variableName`, or both.
 */
export function hasFilterEffect(filter: {
  isBroadcastEnabled?: boolean;
  isVariableEnabled?: boolean;
}): boolean {
  return isFilterBroadcastEnabled(filter) || isFilterVariableEnabled(filter);
}

/**
 * The token a filter is referenced by, falling back to the value derived
 * from its display name.
 */
export function getFilterVariableName(filter: {
  name: string;
  variableName?: string;
}): string | undefined {
  return (
    filter.variableName?.trim() || deriveVariableName(filter.name) || undefined
  );
}

/** A dashboard variable's identity, before any selection is attached. */
export type DashboardVariableDeclaration = Pick<
  ChartVariable,
  'name' | 'expression'
>;

/**
 * The variable-enabled filters a dashboard declares, paired with the name each
 * one answers to, in filter order.
 */
export function getDashboardVariableFilters(
  filters: DashboardFilter[] | undefined,
): { filter: DashboardFilter; name: string }[] {
  const results: { filter: DashboardFilter; name: string }[] = [];
  const takenNames = new Set<string>();

  for (const filter of filters ?? []) {
    if (!isFilterVariableEnabled(filter)) continue;

    // There shouldn't be any duplicate names, but if there are then the first one wins.
    const name = getFilterVariableName(filter);
    if (!name || takenNames.has(name)) continue;
    takenNames.add(name);

    results.push({ filter, name });
  }

  return results;
}

/** Minimal projection of fields necessary to extract the variables a dashboard declares. */
export type FilterForVariableDeclaration = {
  name: string;
  expression?: string;
  variableName?: string;
  isVariableEnabled?: boolean;
};

/** The variables a dashboard declares, in filter order. */
export function getDashboardVariableDeclarations(
  filters: FilterForVariableDeclaration[] | undefined,
): DashboardVariableDeclaration[] {
  const declarations: DashboardVariableDeclaration[] = [];
  const takenNames = new Set<string>();

  for (const filter of filters ?? []) {
    if (!isFilterVariableEnabled(filter)) continue;

    // There shouldn't be any duplicate names, but if there are then the first one wins.
    const name = getFilterVariableName(filter);
    if (!name || takenNames.has(name)) continue;
    takenNames.add(name);

    declarations.push({ name, expression: filter.expression });
  }

  return declarations;
}

export type ResolvedFilterValuesQuery = {
  /** The clause the values lookup actually runs. */
  where: string;
  whereLanguage: 'lucene' | 'sql';
  /** Set when expansion failed; `where` is then the template as written. */
  error?: string;
};

/**
 * Expand the dashboard variables a filter's dropdown-values query references.
 *
 * Never throws. Failures (unknown variables, etc) leave the clause as written, so
 * downstream lookup still runs and reports an `error`.
 */
export function resolveFilterValuesWhere(
  filter: { where?: string; whereLanguage?: 'lucene' | 'sql' },
  variables: ChartVariable[] | undefined,
): ResolvedFilterValuesQuery {
  const where = filter.where ?? '';
  const whereLanguage = filter.whereLanguage ?? 'sql';
  if (variables == null || !where.trim()) {
    return { where, whereLanguage };
  }

  try {
    return {
      where: substituteVariables(where, {
        variables,
        inputLanguage: whereLanguage,
      }),
      whereLanguage,
    };
  } catch (e) {
    return {
      where,
      whereLanguage,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

/**
 * Variables whose selection a filter's dropdown-values query needs before it can
 * match anything.
 *
 * Only bare and braced SQL references qualify. `$__filter` /
 * `$__conditionalAll` expand to `(1=1)`, the `regex` format to `.*`, and a
 * Lucene reference to `("")` (rendered as `(1=1)`), so all of those list every
 * value while their variable is empty. A `sqlstring` reference renders as
 * `NULL` and a `csv` one as nothing at all, which match no rows.
 */
export function getPendingFilterValuesVariables(
  filter: { where?: string; whereLanguage?: 'lucene' | 'sql' },
  variables: ChartVariable[] | undefined,
): string[] {
  const where = filter.where ?? '';
  const whereLanguage = filter.whereLanguage ?? 'sql';
  if (variables == null || !where.trim() || whereLanguage !== 'sql') return [];

  const emptyVariableNames = new Set(
    variables.filter(v => v.values.length === 0).map(v => v.name),
  );
  if (emptyVariableNames.size === 0) return [];

  const pending = getVariableReferences(where)
    .filter(
      reference =>
        reference.kind !== 'macro' &&
        // A reference inside the macro that guards it is only emitted once the
        // variable has values, so it needs no empty-state rendering of its own.
        reference.guardedBy !== reference.name &&
        (reference.format ?? 'sqlstring') !== 'regex' &&
        emptyVariableNames.has(reference.name),
    )
    .map(reference => reference.name);

  return Array.from(new Set(pending));
}

/**
 * Validate a variable name against the token grammar and against the names
 * already taken by other variable-enabled filters on the same dashboard.
 * Returns an error message, or undefined when the name is usable. Only
 * variable-*enabled* siblings are considered.
 */
export function validateVariableName({
  value,
  otherFilters,
}: {
  value: string | undefined;
  otherFilters: {
    name: string;
    variableName?: string;
    isVariableEnabled?: boolean;
  }[];
}): string | undefined {
  const trimmed = (value ?? '').trim();
  if (!trimmed) {
    return 'Variable name is required';
  }
  if (trimmed.length > DASHBOARD_VARIABLE_NAME_MAX_LENGTH) {
    return `Variable name must be ${DASHBOARD_VARIABLE_NAME_MAX_LENGTH} characters or fewer`;
  }
  if (!DASHBOARD_VARIABLE_NAME_PATTERN_ANCHORED.test(trimmed)) {
    return 'Variable names must start with a letter and may contain only letters, numbers, and underscores';
  }
  const clash = otherFilters.find(
    other =>
      isFilterVariableEnabled(other) &&
      getFilterVariableName(other) === trimmed,
  );
  if (clash) {
    return `This variable name is used by another filter on this dashboard (${clash.name})`;
  }
  return undefined;
}
