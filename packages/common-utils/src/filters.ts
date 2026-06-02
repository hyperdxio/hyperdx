import lucene from '@hyperdx/lucene';

import { parseKeyPath } from '@/core/metadata';
import {
  decodeSpecialTokens,
  isBinaryAST,
  isLeftOnlyAST,
  isNodeRangedTerm,
  isNodeTerm,
  parse,
} from '@/queryParser';
import { Filter } from '@/types';

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
 * Escape a value for use inside a single-quoted SQL string literal. Backslashes
 * are doubled and single quotes are SQL-escaped (`''`). This is the inverse of
 * the unescaping `getBooleanOrUnquotedString` performs in the app's
 * `parseQuery`, so SQL filters emitted here round-trip back into FilterState.
 */
const escapeSqlString = (s: string): string =>
  s.replace(/\\/g, '\\\\').replace(/'/g, "''");

/** Render a FilterState value as a SQL literal (quoted string or bare boolean). */
const toSqlLiteral = (v: string | boolean): string =>
  typeof v === 'boolean' ? String(v) : `'${escapeSqlString(v)}'`;

/**
 * A FilterState key is a raw ClickHouse expression (e.g. a `JSONExtractString(
 * LogAttributes['k.v'], 'p')` produced by "Add to Filters" on a nested-JSON
 * attribute) rather than a plain field path whenever it contains characters
 * that cannot appear in a Lucene field name — parentheses, brackets, quotes, or
 * whitespace. Emitting a Lucene `field:"value"` for such a key makes
 * `lucene.parse` throw at render time (HDX nested-JSON "Add to Filters" crash),
 * so we emit a SQL filter instead; the raw expression is already valid SQL and
 * flows straight into the WHERE clause.
 */
const isSqlExpressionField = (field: string): boolean =>
  /[()[\]{}"'\s]/.test(field);

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

/**
 * Build SQL `IN` / `NOT IN` / `BETWEEN` filters for a single field whose key is
 * a raw ClickHouse expression. The emitted shape matches what the app's
 * `parseQuery`/`extractInClauses` reads back, so these filters round-trip.
 */
const filterStateValuesToSql = (
  column: string,
  values: FilterState[string],
): Filter[] => {
  const conditions: Filter[] = [];

  if (values.included.size > 0) {
    conditions.push({
      type: 'sql' as const,
      condition: `${column} IN (${Array.from(values.included)
        .map(toSqlLiteral)
        .join(', ')})`,
    });
  }
  if (values.excluded.size > 0) {
    conditions.push({
      type: 'sql' as const,
      condition: `${column} NOT IN (${Array.from(values.excluded)
        .map(toSqlLiteral)
        .join(', ')})`,
    });
  }
  if (values.range != null) {
    conditions.push({
      type: 'sql' as const,
      condition: `${column} BETWEEN ${values.range.min} AND ${values.range.max}`,
    });
  }
  return conditions;
};

export const filtersToQuery = (filters: FilterState): Filter[] => {
  return Object.entries(filters)
    .filter(
      ([_, values]) =>
        values.included.size > 0 ||
        values.excluded.size > 0 ||
        values.range != null,
    )
    .flatMap(([key, values]) => {
      const normalizedField = parseKeyPath(key).join('.');

      // Raw SQL expressions (e.g. JSONExtractString(...) from nested-JSON "Add
      // to Filters") can't be represented as a Lucene field name without
      // breaking lucene.parse, so emit SQL filters for them instead. The
      // original `key` already holds the valid ClickHouse expression.
      if (isSqlExpressionField(normalizedField)) {
        return filterStateValuesToSql(key, values);
      }

      const conditions: Filter[] = [];
      const luceneField = escapeLuceneFieldName(normalizedField);

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
