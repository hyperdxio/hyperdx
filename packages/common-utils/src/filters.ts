import * as SQLParser from 'node-sql-parser';

import { replaceJsonExpressions } from '@/core/utils';
import { parse } from '@/queryParser';
import { DashboardFilter, Filter } from '@/types';

export type FilterState = {
  [key: string]: {
    included: Set<string | boolean>;
    excluded: Set<string | boolean>;
    range?: { min: number; max: number }; // For BETWEEN conditions
  };
};

const escapeString = (s: string) => {
  return s.replace(/\\/g, '\\\\').replace(/'/g, "''");
};

export const filtersToQuery = (
  filters: FilterState,
  {
    stringifyKeys = false,
    dateTimeColumns,
  }: { stringifyKeys?: boolean; dateTimeColumns?: Set<string> } = {},
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
      // literal in ClickHouse, so wrap each value in parseDateTime64BestEffort.
      // Skip when stringifyKeys is set: the key is cast via toString(), so the
      // comparison is string-vs-string and a plain literal is correct.
      const isDateTime = !stringifyKeys && (dateTimeColumns?.has(key) ?? false);
      const formatValue = (v: string | boolean): string | boolean =>
        typeof v !== 'string'
          ? v
          : isDateTime
            ? `parseDateTime64BestEffort('${escapeString(v)}', 9)`
            : `'${escapeString(v)}'`;

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
 */
export function validateSavedFilterValues(
  filters: Filter[],
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
 * Note: this only checks that the `where` clause *parses*. It cannot catch a
 * `where`/`expression` that references a non-existent column — that only fails
 * when the query runs against ClickHouse.
 */
export function validateDashboardFilterQueries(
  filters: DashboardFilter[],
): DashboardFilterQueryIssue[] {
  const issues: DashboardFilterQueryIssue[] = [];
  for (const filter of filters) {
    const where = filter.where ?? '';
    if (!where.trim()) continue;
    const language = filter.whereLanguage ?? 'sql';
    if (language !== 'lucene' && language !== 'sql') continue;
    if (!isValidFilterCondition(where, language)) {
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
