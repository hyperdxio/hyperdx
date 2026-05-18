import lucene from '@hyperdx/lucene';

import { parseKeyPath } from '@/core/metadata';
import { decodeSpecialTokens, parse } from '@/queryParser';
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
      const luceneField = parseKeyPath(key).join('.');

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
        conditions.push({
          type: 'sql' as const,
          condition: `${key} BETWEEN ${values.range.min} AND ${values.range.max}`,
        });
      }
      return conditions;
    });
};

// Type guards for lucene AST
function isNodeTerm(node: lucene.Node | lucene.AST): node is lucene.NodeTerm {
  return 'term' in node && node.term != null;
}
function isBinaryAST(ast: lucene.AST | lucene.Node): ast is lucene.BinaryAST {
  return 'right' in ast && ast.right != null;
}
function isLeftOnlyAST(
  ast: lucene.AST | lucene.Node,
): ast is lucene.LeftOnlyAST {
  return (
    'left' in ast && ast.left != null && !('right' in ast && ast.right != null)
  );
}

/**
 * Collect all quoted terms from a Lucene AST into flat {field, value, negated} tuples.
 */
function collectTerms(
  ast: lucene.AST | lucene.Node,
): { field: string; value: string; negated: boolean }[] {
  if (isNodeTerm(ast)) {
    if (!ast.quoted) return [];
    const negated = ast.field.startsWith('-');
    const field = negated ? ast.field.slice(1) : ast.field;
    return [{ field, value: decodeSpecialTokens(ast.term), negated }];
  }
  if (isBinaryAST(ast)) {
    return [...collectTerms(ast.left), ...collectTerms(ast.right)];
  }
  if (isLeftOnlyAST(ast)) {
    return collectTerms(ast.left);
  }
  return [];
}

/**
 * Parse a Lucene filter condition back into per-field included/excluded values.
 * Handles mixed conditions like `-service:"bingo" level:"info" (service:"foo" OR service:"bar")`.
 *
 * Returns an array with one entry per distinct field, or undefined if parsing fails.
 */
/** Coerce "true"/"false" strings back to booleans, pass through otherwise */
function coerceBooleanValue(v: string): string | boolean {
  if (v === 'true') return true;
  if (v === 'false') return false;
  return v;
}

export function parseLuceneFilter(condition: string):
  | {
      key: string;
      included: (string | boolean)[];
      excluded: (string | boolean)[];
    }[]
  | undefined {
  try {
    const ast = parse(condition);
    const terms = collectTerms(ast);
    if (terms.length === 0) return undefined;

    // Group by field, coercing "true"/"false" back to booleans
    const byField = new Map<
      string,
      { included: (string | boolean)[]; excluded: (string | boolean)[] }
    >();
    for (const t of terms) {
      if (!byField.has(t.field)) {
        byField.set(t.field, { included: [], excluded: [] });
      }
      const entry = byField.get(t.field)!;
      const value = coerceBooleanValue(t.value);
      if (t.negated) {
        entry.excluded.push(value);
      } else {
        entry.included.push(value);
      }
    }

    return Array.from(byField.entries()).map(([key, vals]) => ({
      key,
      ...vals,
    }));
  } catch {
    return undefined;
  }
}
