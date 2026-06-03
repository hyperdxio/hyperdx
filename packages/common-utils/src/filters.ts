import lucene from '@hyperdx/lucene';
import * as SQLParser from 'node-sql-parser';

import { parseKeyPath } from '@/core/metadata';
import { replaceJsonExpressions } from '@/core/utils';
import {
  decodeSpecialTokens,
  isBinaryAST,
  isLeftOnlyAST,
  isNodeRangedTerm,
  isNodeTerm,
  parse,
} from '@/queryParser';
import { DashboardFilter, Filter } from '@/types';

export type FilterState = {
  [key: string]: {
    included: Set<string | boolean>;
    excluded: Set<string | boolean>;
    range?: { min: number; max: number }; // For BETWEEN conditions
  };
};

/** Escape a value for use inside a Lucene quoted term ("...") */
const escapeLuceneQuotedTerm = (s: string) => {
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
};

/**
 * Escape backslashes and colons so the field name survives Lucene parsing.
 * Map sub-keys can legitimately contain `:` (e.g. `LogAttributes['foo:bar']`
 * normalizes to `LogAttributes.foo:bar` via parseKeyPath().join('.')), and
 * `:` is the Lucene field/value separator. Backslashes are escaped first so
 * the inserted `\:` survives `encodeSpecialTokens`' `\\` → backslash-literal
 * substitution; the encoder's matching `\:` → HDX_COLON rule then makes the
 * colon opaque to the parser, and `decodeSpecialTokens` restores the
 * original key on the consumer side.
 */
const escapeLuceneFieldName = (key: string): string =>
  key.replace(/\\/g, '\\\\').replace(/:/g, '\\:');

export const filtersToQuery = (filters: FilterState): Filter[] => {
  return Object.entries(filters)
    .filter(
      ([_, values]) =>
        values.included.size > 0 ||
        values.excluded.size > 0 ||
        values.range != null,
    )
    .flatMap(([key, values]) => {
      const conditions: Filter[] = [];
      const luceneField = escapeLuceneFieldName(parseKeyPath(key).join('.'));

      if (values.included.size > 0) {
        const terms = Array.from(values.included).map(
          v => `${luceneField}:"${escapeLuceneQuotedTerm(String(v))}"`,
        );
        conditions.push({
          type: 'lucene' as const,
          condition: terms.length > 1 ? `(${terms.join(' OR ')})` : terms[0],
        });
      }
      if (values.excluded.size > 0) {
        conditions.push({
          type: 'lucene' as const,
          condition: Array.from(values.excluded)
            .map(v => `-${luceneField}:"${escapeLuceneQuotedTerm(String(v))}"`)
            .join(' AND '),
        });
      }

      if (values.range != null) {
        // Lucene range syntax: field:[min TO max]
        conditions.push({
          type: 'lucene' as const,
          condition: `${luceneField}:[${values.range.min} TO ${values.range.max}]`,
        });
      }
      return conditions;
    });
};

type CollectedTerm = { field: string; value: string; negated: boolean };
type CollectedRange = { field: string; min: number; max: number };

/**
 * Collect quoted terms and range terms from a Lucene AST.
 */
function collectFromAst(
  ast: lucene.AST | lucene.Node,
  terms: CollectedTerm[],
  ranges: CollectedRange[],
): void {
  if (isNodeTerm(ast)) {
    if (!ast.quoted) return;
    const negated = ast.field.startsWith('-');
    const field = decodeSpecialTokens(negated ? ast.field.slice(1) : ast.field);
    terms.push({ field, value: decodeSpecialTokens(ast.term), negated });
  } else if (isNodeRangedTerm(ast)) {
    const field = decodeSpecialTokens(ast.field);
    const min = parseFloat(ast.term_min);
    const max = parseFloat(ast.term_max);
    if (!isNaN(min) && !isNaN(max)) {
      ranges.push({ field, min, max });
    }
  } else if (isBinaryAST(ast)) {
    collectFromAst(ast.left, terms, ranges);
    collectFromAst(ast.right, terms, ranges);
  } else if (isLeftOnlyAST(ast)) {
    collectFromAst(ast.left, terms, ranges);
  }
}

/** Coerce "true"/"false" strings back to booleans, pass through otherwise */
export function coerceBooleanValue(v: string | boolean): string | boolean {
  if (typeof v === 'boolean') return v;
  if (v === 'true') return true;
  if (v === 'false') return false;
  return v;
}

export type ParsedLuceneFilter = {
  key: string;
  included: (string | boolean)[];
  excluded: (string | boolean)[];
  range?: { min: number; max: number };
};

/**
 * Parse a Lucene filter condition back into per-field included/excluded values
 * and optional ranges.
 *
 * Returns an array with one entry per distinct field (empty array if the input
 * is valid Lucene but contains no quoted terms or ranges), or undefined if
 * parsing fails entirely.
 */
export function parseLuceneFilter(
  condition: string,
): ParsedLuceneFilter[] | undefined {
  try {
    const ast = parse(condition);
    const terms: CollectedTerm[] = [];
    const ranges: CollectedRange[] = [];
    collectFromAst(ast, terms, ranges);

    // Group by field, coercing "true"/"false" back to booleans
    const byField = new Map<
      string,
      {
        included: (string | boolean)[];
        excluded: (string | boolean)[];
        range?: { min: number; max: number };
      }
    >();

    const getEntry = (field: string) => {
      if (!byField.has(field)) {
        byField.set(field, { included: [], excluded: [] });
      }
      return byField.get(field)!;
    };

    for (const t of terms) {
      const entry = getEntry(t.field);
      const value = coerceBooleanValue(t.value);
      if (t.negated) {
        entry.excluded.push(value);
      } else {
        entry.included.push(value);
      }
    }

    for (const r of ranges) {
      const entry = getEntry(r.field);
      entry.range = { min: r.min, max: r.max };
    }

    return Array.from(byField.entries()).map(([key, vals]) => ({
      key,
      ...vals,
    }));
  } catch {
    return undefined;
  }
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
 * `where` clause is malformed Lucene/SQL would otherwise only reveal itself as
 * a failed query once the dashboard is opened. Returns one issue per filter
 * whose `where` fails to parse as its declared language.
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
