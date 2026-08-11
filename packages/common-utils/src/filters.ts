import type * as lucene from '@hyperdx/lucene';
import * as SQLParser from 'node-sql-parser';

import { dateTimeValueExpr } from '@/core/dateTimeValue';
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
    range?: {
      min: number;
      max: number;
      /**
       * Lucene range bracket style: 'both' ([min TO max]), 'none' ({min TO max}),
       * 'left' ([min TO max}), 'right' ({min TO max]).
       * Defaults to 'both' (fully inclusive) when not set.
       */
      inclusive?: 'both' | 'none' | 'left' | 'right';
    };
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
            ? dateTimeValueExpr(chType, `'${escapeString(v)}'`)
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

/** The Lucene sentinel the parser uses for terms without an explicit field. */
const IMPLICIT_FIELD = '<implicit>';

/** Escape a value for use inside a Lucene quoted term ("...") */
const escapeLuceneQuotedTerm = (s: string) => {
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
};

/**
 * Escape characters in a field name that would break Lucene syntax.
 *
 * Lucene treats several characters as syntax in field names / at the
 * field:value boundary:
 *   - `\`  – escape prefix (must come first so later replacements survive)
 *   - `:`  – field/value separator
 *   - `(`  `)` – grouping / field-group open/close
 *   - `"`  – quoted-value delimiter
 *   - `{`  `}` – exclusive range bracket
 *   - `[`  `]` – inclusive range bracket
 *   - ` `  (space) – token separator
 *
 * Backslashes are escaped first so the `\X` sequences we insert later are
 * not double-processed.  The encoder's special-token rules (`encodeSpecialTokens`)
 * handle `\:` → HDX_COLON so that colons survive the parser; the other
 * characters are simply backslash-escaped in the raw Lucene text.
 */
const escapeLuceneFieldName = (key: string): string =>
  key
    .replace(/\\/g, '\\\\')
    .replace(/:/g, '\\:')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)')
    .replace(/"/g, '\\"')
    .replace(/\{/g, '\\{')
    .replace(/\}/g, '\\}')
    .replace(/\[/g, '\\[')
    .replace(/\]/g, '\\]')
    .replace(/ /g, '\\ ');

/**
 * Reverse `escapeLuceneFieldName`: strip the backslash-escapes that
 * `escapeLuceneFieldName` introduced so the raw key can be matched against
 * FilterState entries.
 *
 * The Lucene parser preserves backslash-escape sequences in field names (e.g.
 * `my\ key` stays `my\ key` in `ast.field`). `decodeSpecialTokens` handles
 * `\:` (via the HDX_COLON round-trip) and `\"`, but not the other nine
 * characters that `escapeLuceneFieldName` escapes. Without this decoder, a
 * key like `LogAttributes['my key']` emits `LogAttributes.my\ key:"v"`, the
 * parser returns the field as `LogAttributes.my\ key`, and `decodeSpecialTokens`
 * leaves the backslash intact — so the key never matches the FilterState entry
 * and the backslash multiplies on every subsequent render.
 *
 * Decoding order: unescape `\\` last (so `\\(` → `\(` → `(` doesn't
 * accidentally strip a legitimate backslash introduced by a prior step).
 * Colons and double-quotes are decoded by `decodeSpecialTokens` already but
 * are included here for completeness — double-decoding is safe because the
 * HDX_COLON / `\"` rules never produce a bare `\:` or `\"`.
 */
const decodeLuceneFieldName = (raw: string): string =>
  raw
    .replace(/\\ /g, ' ')
    .replace(/\\\(/g, '(')
    .replace(/\\\)/g, ')')
    .replace(/\\"/g, '"')
    .replace(/\\\{/g, '{')
    .replace(/\\\}/g, '}')
    .replace(/\\\[/g, '[')
    .replace(/\\\]/g, ']')
    .replace(/\\\\/g, '\\');

/**
 * Fully decode a Lucene field name back to its original form.  Combines
 * `decodeSpecialTokens` (which reverses the HDX_COLON / `\"` encoding applied
 * before parsing) with `decodeLuceneFieldName` (which strips the
 * backslash-escapes added by `escapeLuceneFieldName`).  Every place that
 * extracts a field name from the AST should use this instead of calling
 * `decodeSpecialTokens` directly on the field.
 */
const decodeFieldName = (raw: string): string =>
  decodeLuceneFieldName(decodeSpecialTokens(raw));

/**
 * Render a FilterState as a single `where` clause string in the given query
 * language.
 *
 * - `sql`: emits the same `<key> IN (...) / NOT IN (...) / BETWEEN ... AND ...`
 *   predicates `filtersToQuery` produces, remapping every clean key through
 *   `escapeKey` first (the app passes `toQuotedClickHouseKeyExpression`).
 * - `lucene`: emits `field:"value"` terms, parenthesized `OR` groups for
 *   multi-value includes, negated `-field:"value"` terms for excludes, and
 *   `field:[min TO max]` ranges — the grammar that `parseWhereClauseToFilterState`
 *   reads back.
 *
 * This is the emission half of the search page's unified
 * sidebar-⇄-query-input representation. Keys are the clean (dot-form) keys the
 * sidebar uses.
 */
export function filterStateToWhereClause(
  state: FilterState,
  {
    language,
    escapeKey,
    dateTimeColumns,
  }: {
    language: 'lucene' | 'sql';
    /** SQL only: map a clean key to its quoted ClickHouse expression. */
    escapeKey?: (key: string) => string;
    /** SQL only: Map of DateTime/Date column name → its ClickHouse type. */
    dateTimeColumns?: ReadonlyMap<string, string>;
  },
): string {
  if (language === 'sql') {
    const escaped: FilterState = {};
    for (const [key, values] of Object.entries(state)) {
      escaped[escapeKey ? escapeKey(key) : key] = values;
    }
    return filtersToQuery(escaped, { dateTimeColumns })
      .flatMap(f => ('condition' in f ? [f.condition] : []))
      .join(' AND ');
  }

  const clauses: string[] = [];
  for (const [key, values] of Object.entries(state)) {
    if (
      values.included.size === 0 &&
      values.excluded.size === 0 &&
      values.range == null
    ) {
      continue;
    }
    const luceneField = escapeLuceneFieldName(parseKeyPath(key).join('.'));

    if (values.included.size > 0) {
      const terms = Array.from(values.included).map(
        v => `${luceneField}:"${escapeLuceneQuotedTerm(String(v))}"`,
      );
      clauses.push(terms.length > 1 ? `(${terms.join(' OR ')})` : terms[0]);
    }
    if (values.excluded.size > 0) {
      clauses.push(
        Array.from(values.excluded)
          .map(v => `-${luceneField}:"${escapeLuceneQuotedTerm(String(v))}"`)
          .join(' AND '),
      );
    }
    if (values.range != null) {
      const open =
        values.range.inclusive === 'none' || values.range.inclusive === 'right'
          ? '{'
          : '[';
      const close =
        values.range.inclusive === 'none' || values.range.inclusive === 'left'
          ? '}'
          : ']';
      clauses.push(
        `${luceneField}:${open}${values.range.min} TO ${values.range.max}${close}`,
      );
    }
  }
  return clauses.join(' AND ');
}

type CollectedTerm = { field: string; value: string; negated: boolean };
type CollectedRange = {
  field: string;
  min: number;
  max: number;
  inclusive?: 'both' | 'none' | 'left' | 'right';
};

/**
 * Return true when a `NodeTerm` carries a proximity (~N), fuzzy (~), or boost
 * (^N) modifier. The `@hyperdx/lucene` package ships no `.d.ts` file so
 * TypeScript infers these optional properties as absent from `NodeTerm`; we
 * access them through an `unknown` cast to stay type-safe while still checking
 * the runtime values the grammar always sets (to `null` when absent).
 */
function hasTermModifiers(node: lucene.NodeTerm): boolean {
  const hasProximity = 'proximity' in node && node.proximity != null;
  return hasProximity || node.boost != null || node.similarity != null;
}

/**
 * Collect quoted terms and range terms from a Lucene AST into the `terms` /
 * `ranges` arrays.  `managedFields` collects every explicit-field name that we
 * should treat as "managed" even when we cannot faithfully round-trip the value
 * (unquoted terms, field groups).  `collectFromAst` is only called in contexts
 * that build the `managed` set, so this wider set lets `renderNode` prune
 * unquoted field clauses (Bug 7) and field-group clauses (Bug 3).
 *
 * Cross-field OR rules (Bug 2): when an OR node connects clauses for *different*
 * fields, the relationship cannot be expressed in FilterState (which has AND
 * semantics across fields), so we treat the whole OR sub-tree as unmanaged —
 * neither side is collected, and `renderNode` will preserve the raw text.
 */
/**
 * Walk an OR subtree and return true if `collectFromAst` would yield at least
 * one negated term from this side.  Used by the same-field OR branch to detect
 * mixed included/excluded clauses (e.g. `a:"1" OR -a:"2"`, `a:"1" OR NOT a:"2"`,
 * `NOT a:"1" OR a:"2"`) which FilterState cannot faithfully represent because
 * excluded values are emitted with AND semantics that narrow the OR branch.
 *
 * Mirrors the negation logic of `collectFromAst` without mutating the caller's
 * collections.
 */
function orSideHasNegatedTerm(
  ast: lucene.AST | lucene.Node,
  negate = false,
): boolean {
  if (isNodeTerm(ast)) {
    if (ast.field === IMPLICIT_FIELD) return false;
    const negatedField = ast.field.startsWith('-');
    return negatedField !== negate;
  }
  if (isNodeRangedTerm(ast)) {
    if (ast.field === IMPLICIT_FIELD) return false;
    return negate;
  }
  if (isLeftOnlyAST(ast)) {
    return orSideHasNegatedTerm(ast.left, negate !== (ast.start === 'NOT'));
  }
  if (isBinaryAST(ast)) {
    const startOp: string | undefined =
      'start' in ast && typeof ast.start === 'string' ? ast.start : undefined;
    const leftNegate = negate !== (startOp === 'NOT');
    const rightNegate =
      negate !== (ast.operator === 'AND NOT' || ast.operator === 'OR NOT');
    return (
      orSideHasNegatedTerm(ast.left, leftNegate) ||
      orSideHasNegatedTerm(ast.right, rightNegate)
    );
  }
  return false;
}

function collectFromAst(
  ast: lucene.AST | lucene.Node,
  terms: CollectedTerm[],
  ranges: CollectedRange[],
  managedFields: Set<string>,
  negate = false,
): void {
  if (isNodeTerm(ast)) {
    // `negate` carries a `NOT` (or `+`/`-`) wrapper from an enclosing node, so
    // `NOT a:"1"` / `a AND NOT b:"2"` collect as excluded instead of included.
    // A `-` prefix XORs with the wrapper (`NOT -a` is not negated). Only a
    // literal `-` prefix is sliced off the field name.
    const negatedField = ast.field.startsWith('-');
    const negated = negatedField !== negate;
    const field = decodeFieldName(
      negatedField ? ast.field.slice(1) : ast.field,
    );
    // Implicit-field terms (free-text, quoted phrases) are never managed facets.
    if (field === IMPLICIT_FIELD) return;

    // Terms with proximity (~N), fuzzy (~), or boost (^N) modifiers cannot be
    // faithfully represented in FilterState, so treat them as unmanaged (Bug 6).
    // However the field is still marked managed so that sibling plain clauses
    // for the same field are pruned by renderNode rather than left to pile up
    // alongside the new emission.
    if (hasTermModifiers(ast)) {
      managedFields.add(field);
      return;
    }

    // Collect the field as managed so renderNode can prune it (Bug 7).
    managedFields.add(field);

    if (!ast.quoted) {
      // Unquoted terms are managed for *removal* (so the old unquoted clause
      // doesn't linger when the sidebar replaces it with a quoted one), but we
      // don't add them to `terms` — the sidebar always emits quoted values.
      return;
    }

    terms.push({ field, value: decodeSpecialTokens(ast.term), negated });
  } else if (isNodeRangedTerm(ast)) {
    const field = decodeFieldName(ast.field);
    if (field === IMPLICIT_FIELD) return;
    // A negated range (`NOT duration:[10 TO 20]`) can't be represented in
    // FilterState, so leave it unmanaged and preserve it verbatim. But still
    // mark the field as managed so plain range clauses on the same field don't
    // survive alongside the new emission.
    if (negate) {
      managedFields.add(field);
      return;
    }
    const min = parseFloat(ast.term_min);
    const max = parseFloat(ast.term_max);
    if (!isNaN(min) && !isNaN(max)) {
      managedFields.add(field);
      const inclusive =
        (ast.inclusive as 'both' | 'none' | 'left' | 'right') ?? 'both';
      ranges.push({
        field,
        min,
        max,
        // Only store non-default inclusivity so round-tripping `[min TO max]`
        // doesn't add an unexpected `inclusive` key to the range object.
        ...(inclusive !== 'both' ? { inclusive } : {}),
      });
    }
  } else if (isBinaryAST(ast)) {
    // Field-group syntax: ServiceName:("api" OR "web").  The parser puts a
    // non-implicit `field` on the BinaryAST wrapper (Bug 3).  Collect its
    // inner leaf values as if they had the group's field name.
    const groupField =
      'field' in ast &&
      typeof ast.field === 'string' &&
      ast.field !== IMPLICIT_FIELD
        ? decodeFieldName(ast.field)
        : null;

    if (groupField) {
      // Collect each leaf of the field group under the group's field name.
      managedFields.add(groupField);
      collectFieldGroupLeaves(ast, groupField, terms, managedFields, negate);
      return;
    }

    // Cross-field OR: if this OR node connects clauses for *different* fields,
    // we cannot represent that in FilterState, so leave both sides unmanaged
    // (Bug 2).  Same-field OR (e.g. `level:"info" OR level:"warn"`) is fine —
    // both leaves map to the same field and end up as multiple `included`
    // values, which filterStateToWhereClause re-emits as a single OR group.
    //
    // However a same-field OR that mixes included and excluded sides
    // (e.g. `a:"1" OR NOT a:"2"` or `a:"1" OR -a:"2"`) cannot be faithfully
    // represented: FilterState has AND semantics, so an excluded value is
    // emitted as `-a:"2"` ANDed with the included group, narrowing the OR
    // branch. Leave the OR unmanaged so renderNode preserves the raw text.
    //
    // `OR NOT` is an OR too (a:"1" OR NOT b:"2" is cross-field and unrepresentable).
    if (ast.operator === 'OR' || ast.operator === 'OR NOT') {
      const leftFields = new Set<string>();
      const rightFields = new Set<string>();
      collectExplicitFields(ast.left, leftFields);
      collectExplicitFields(ast.right, rightFields);
      const isSameField =
        leftFields.size > 0 &&
        rightFields.size > 0 &&
        leftFields.size === 1 &&
        rightFields.size === 1 &&
        [...leftFields][0] === [...rightFields][0];

      if (!isSameField) {
        // Cross-field OR — do not add either side to managed, leave raw.
        return;
      }

      // Inspect each side without mutating the caller's managedFields. A side
      // contributes a negated term when its outer NOT wrapper, the `-` prefix
      // on its field, or a transitive negation inside the subtree flips it.
      // The right subtree of an `OR NOT` operator is also negated.
      const startOp: string | undefined =
        'start' in ast && typeof ast.start === 'string' ? ast.start : undefined;
      const leftNegate = negate !== (startOp === 'NOT');
      const rightNegate = negate !== (ast.operator === 'OR NOT');
      if (
        orSideHasNegatedTerm(ast.left, leftNegate) ||
        orSideHasNegatedTerm(ast.right, rightNegate)
      ) {
        // Same-field OR with a negated side is unrepresentable in FilterState
        // (its AND semantics would narrow the OR branch). Leave both sides
        // unmanaged so the original expression is preserved verbatim.
        return;
      }
      // Plain same-field OR: fall through to the generic binary collection
      // below so ranges and unquoted terms on the same field are also picked up.
    }

    // A `start: 'NOT'` on the binary node negates its left subtree (`NOT a AND
    // b`); an `AND NOT` / `OR NOT` operator negates the right subtree.
    const startOp: string | undefined =
      'start' in ast && typeof ast.start === 'string' ? ast.start : undefined;
    const leftNegate = negate !== (startOp === 'NOT');
    const rightNegate =
      negate !== (ast.operator === 'AND NOT' || ast.operator === 'OR NOT');
    collectFromAst(ast.left, terms, ranges, managedFields, leftNegate);
    collectFromAst(ast.right, terms, ranges, managedFields, rightNegate);
  } else if (isLeftOnlyAST(ast)) {
    collectFromAst(
      ast.left,
      terms,
      ranges,
      managedFields,
      negate !== (ast.start === 'NOT'),
    );
  }
}

/**
 * Recursively collect leaf terms from a field-group BinaryAST, assigning them
 * the `groupField` instead of `<implicit>`.
 */
function collectFieldGroupLeaves(
  ast: lucene.AST | lucene.Node,
  groupField: string,
  terms: CollectedTerm[],
  managedFields: Set<string>,
  negate = false,
): void {
  if (isNodeTerm(ast)) {
    // Skip modifiers — proximity/boost can't be faithfully round-tripped.
    if (hasTermModifiers(ast)) {
      return;
    }
    if (!ast.quoted) return; // unquoted inside group: add field but no value
    const negated = ast.field.startsWith('-') !== negate;
    terms.push({
      field: groupField,
      value: decodeSpecialTokens(ast.term),
      negated,
    });
  } else if (isBinaryAST(ast)) {
    collectFieldGroupLeaves(ast.left, groupField, terms, managedFields, negate);
    collectFieldGroupLeaves(
      ast.right,
      groupField,
      terms,
      managedFields,
      negate,
    );
  } else if (isLeftOnlyAST(ast)) {
    collectFieldGroupLeaves(ast.left, groupField, terms, managedFields, negate);
  }
}

/** Coerce "true"/"false" strings back to booleans, pass through otherwise */
export function coerceBooleanValue(v: string | boolean): string | boolean {
  if (typeof v === 'boolean') return v;
  if (v === 'true') return true;
  if (v === 'false') return false;
  return v;
}

/**
 * Parse a `where` clause string back into a FilterState (clean keys), the
 * inverse of `filterStateToWhereClause`.
 *
 * - `sql`: delegates to `parseQuery`, so keys come back in their raw SQL
 *   (quoted/bracket) form — callers that need clean keys unescape them.
 * - `lucene`: collects quoted `field:"value"` terms (included / negated =
 *   excluded) and `field:[min TO max]` ranges. Only clauses matching the
 *   facet grammar round-trip; free-text and complex queries are ignored.
 *
 * Returns an empty state when the text is empty or (for lucene) fails to parse.
 */
export function parseWhereClauseToFilterState(
  whereText: string,
  language: 'lucene' | 'sql',
): FilterState {
  if (language === 'sql') {
    // Split the where text into top-level conjuncts before calling parseQuery
    // so that a multi-line query like "Body LIKE '%x%'\nAND ServiceName IN
    // ('api')" is not treated as a single compound filter whose key is the
    // entire text up to the IN keyword. Each conjunct is passed to parseQuery
    // individually, matching what replaceSqlFacetClauses does internally.
    const { code } = stripSqlComments(whereText.trim());
    const conjuncts = splitSqlConjuncts(code).filter(c => c.trim());
    return parseQuery(
      conjuncts.map(c => ({ type: 'sql' as const, condition: c })),
    ).filters;
  }

  try {
    const ast = parse(whereText);
    const terms: CollectedTerm[] = [];
    const ranges: CollectedRange[] = [];
    const managedFields = new Set<string>();
    collectFromAst(ast, terms, ranges, managedFields);

    const byField = new Map<
      string,
      {
        included: Set<string | boolean>;
        excluded: Set<string | boolean>;
        range?: {
          min: number;
          max: number;
          inclusive?: 'both' | 'none' | 'left' | 'right';
        };
      }
    >();
    const getEntry = (field: string) => {
      if (!byField.has(field)) {
        byField.set(field, { included: new Set(), excluded: new Set() });
      }
      return byField.get(field)!;
    };

    for (const t of terms) {
      const entry = getEntry(t.field);
      // Do NOT coerce "true"/"false" strings to booleans here. Lucene always
      // stores values as quoted strings, so `msg:"true"` is the string "true",
      // not the boolean. Coercing at parse time would cause SQL emission to
      // produce bare `msg IN (true)` — a type error for String columns. Boolean
      // coercion is the responsibility of the caller when it knows the column
      // type is Boolean (e.g. `isRootSpan`).
      if (t.negated) {
        entry.excluded.add(t.value);
      } else {
        entry.included.add(t.value);
      }
    }
    for (const r of ranges) {
      const entry = getEntry(r.field);
      entry.range = {
        min: r.min,
        max: r.max,
        ...(r.inclusive != null ? { inclusive: r.inclusive } : {}),
      };
    }
    return Object.fromEntries(byField);
  } catch {
    return {};
  }
}

/**
 * Return a non-null message when a `where` clause cannot be parsed in the given
 * query language (e.g. an incomplete lucene query like `service:`). The message
 * is intended for a UI notice — callers can treat any non-null value as "the
 * query is invalid/incomplete".
 *
 * `sql` always returns null: there is no strict SQL parser here and
 * `parseQuery` is tolerant, so we can't reliably distinguish invalid from valid.
 */
export function getWhereParseError(
  whereText: string,
  language: 'lucene' | 'sql',
): string | null {
  if (!whereText.trim()) return null;
  if (language === 'sql') return null;
  try {
    parse(whereText);
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : 'Invalid query';
  }
}

/**
 * Collect every explicit-field name referenced under a lucene AST node, using
 * the field's decoded name (stripping `-`/`+` prefixes). Used to detect
 * cross-field OR constructs.
 */
function collectExplicitFields(
  node: lucene.AST | lucene.Node,
  out: Set<string>,
): void {
  if (isNodeTerm(node)) {
    const raw =
      node.field.startsWith('-') || node.field.startsWith('+')
        ? node.field.slice(1)
        : node.field;
    const field = decodeFieldName(raw);
    if (field !== IMPLICIT_FIELD) out.add(field);
    return;
  }
  if (isNodeRangedTerm(node)) {
    const field = decodeFieldName(node.field);
    if (field !== IMPLICIT_FIELD) out.add(field);
    return;
  }
  if (isBinaryAST(node)) {
    const groupField =
      'field' in node &&
      typeof node.field === 'string' &&
      node.field !== IMPLICIT_FIELD
        ? decodeFieldName(node.field)
        : null;
    if (groupField) {
      // Field-group syntax: all inner leaves belong to the group's field.
      out.add(groupField);
      return;
    }
    collectExplicitFields(node.left, out);
    collectExplicitFields(node.right, out);
    return;
  }
  if (isLeftOnlyAST(node)) {
    collectExplicitFields(node.left, out);
  }
}

/**
 * Return true when a lucene AST contains an OR (or OR NOT) node connecting
 * clauses for different explicit fields OR a same-field OR with a negated side.
 * Such a query cannot be represented as a FilterState (which has AND semantics
 * across fields and between included/excluded sets), so the sidebar would
 * either silently drop it or mislead.
 */
function hasUnrepresentableOr(node: lucene.AST | lucene.Node): boolean {
  if (isNodeTerm(node) || isNodeRangedTerm(node)) return false;
  if (isLeftOnlyAST(node)) return hasUnrepresentableOr(node.left);
  if (isBinaryAST(node)) {
    const groupField =
      'field' in node &&
      typeof node.field === 'string' &&
      node.field !== IMPLICIT_FIELD
        ? decodeFieldName(node.field)
        : null;
    if (groupField) {
      return (
        hasUnrepresentableOr(node.left) || hasUnrepresentableOr(node.right)
      );
    }
    if (node.operator === 'OR' || node.operator === 'OR NOT') {
      const leftFields = new Set<string>();
      const rightFields = new Set<string>();
      collectExplicitFields(node.left, leftFields);
      collectExplicitFields(node.right, rightFields);
      const isSameField =
        leftFields.size > 0 &&
        rightFields.size > 0 &&
        leftFields.size === 1 &&
        rightFields.size === 1 &&
        [...leftFields][0] === [...rightFields][0];
      if (!isSameField) return true;

      const startOp: string | undefined =
        'start' in node && typeof node.start === 'string'
          ? node.start
          : undefined;
      const leftNegate = startOp === 'NOT';
      const rightNegate = node.operator === 'OR NOT';
      if (
        orSideHasNegatedTerm(node.left, leftNegate) ||
        orSideHasNegatedTerm(node.right, rightNegate)
      ) {
        return true;
      }
    }
    return hasUnrepresentableOr(node.left) || hasUnrepresentableOr(node.right);
  }
  return false;
}

/**
 * Return a non-null reason when a `where` clause parses but contains facet-like
 * content the sidebar FilterState cannot faithfully represent — currently a
 * cross-field OR or a same-field OR with a negated term. The UI should surface
 * this instead of showing a misleading or silently-emptied filter sidebar.
 * `sql` always returns null.
 */
export function getUnrepresentableWhereReason(
  whereText: string,
  language: 'lucene' | 'sql',
): string | null {
  if (!whereText.trim()) return null;
  if (language === 'sql') return null;
  try {
    const ast = parse(whereText);
    if (hasUnrepresentableOr(ast)) {
      return 'This query contains OR conditions that cannot be shown as sidebar filters.';
    }
    return null;
  } catch {
    return null;
  }
}

type Span = { start: number; end: number };

function termClauseSpan(node: lucene.NodeTerm, src: string): Span | null {
  const tl = node.termLocation;
  if (!tl?.end) return null;
  const start = node.fieldLocation?.start?.offset ?? tl.start?.offset;
  if (start == null) return null;
  // Bug 10 fix: termLocation.end.offset can include trailing whitespace (the
  // grammar's `_*` consumes whitespace after the term).  Trim to avoid
  // accumulating extra spaces when the residual is re-joined with an operator.
  let end = tl.end.offset;
  while (end > start && (src[end - 1] === ' ' || src[end - 1] === '\t')) {
    end--;
  }
  return { start, end };
}

function rangeClauseSpan(
  node: lucene.NodeRangedTerm,
  src: string,
): Span | null {
  const fl = node.fieldLocation;
  // Bug 4 fix: use == null instead of falsy check so offset=0 is not dropped.
  if (fl?.start?.offset == null || !fl.end?.offset) return null;
  // Bug 5 fix: the range may end with `]` (inclusive) or `}` (exclusive).
  // Search for whichever closing bracket appears first after the field end.
  const searchFrom = fl.end.offset;
  const closeSq = src.indexOf(']', searchFrom);
  const closeCurly = src.indexOf('}', searchFrom);
  let endBracket: number;
  if (closeSq === -1 && closeCurly === -1) return null;
  if (closeSq === -1) endBracket = closeCurly;
  else if (closeCurly === -1) endBracket = closeSq;
  else endBracket = Math.min(closeSq, closeCurly);
  return { start: fl.start.offset, end: endBracket + 1 };
}

type RenderResult = {
  /** Rendered residual text (empty when every leaf was a facet clause). */
  text: string;
  /** Whether every leaf under this node is a managed facet clause. */
  fullyManaged: boolean;
};

/**
 * Render a Lucene AST back to text, pruning every leaf whose field is in
 * `isManagedField` and keeping the raw source text of everything else. Sibling
 * connectors are re-emitted from the tree so that removing a clause from an
 * OR/AND chain doesn't leave dangling operators (e.g. removing `host` from
 * `foo:"x" AND host:"a" AND bar:"y"` yields `foo:"x" AND bar:"y"`, and from
 * `(a OR host OR b)` yields `(a OR b)`).
 *
 * `negate` mirrors the same flag in `collectFromAst`: negated ranges
 * (`NOT duration:[...]`) cannot be represented in FilterState and must be
 * preserved verbatim even when their field is managed.
 */
function renderNode(
  node: lucene.AST | lucene.Node,
  src: string,
  isManagedField: (field: string) => boolean,
  negate = false,
): RenderResult {
  if (isNodeTerm(node)) {
    const span = termClauseSpan(node, src);
    if (!span) return { text: '', fullyManaged: false };
    if (!node.quoted) {
      // Bug 7 fix: unquoted explicit-field terms (e.g. level:error) must also
      // be pruned when their field is managed, so the sidebar can replace them
      // with a quoted clause without duplication.
      const rawField = node.field.startsWith('-')
        ? node.field.slice(1)
        : node.field;
      const field = decodeFieldName(rawField);
      if (field !== IMPLICIT_FIELD && isManagedField(field)) {
        return { text: '', fullyManaged: true };
      }
      return { text: src.slice(span.start, span.end), fullyManaged: false };
    }
    const field = decodeFieldName(
      node.field.startsWith('-') ? node.field.slice(1) : node.field,
    );
    // Terms with modifiers (proximity, boost, fuzzy) are not managed.
    if (hasTermModifiers(node)) {
      return { text: src.slice(span.start, span.end), fullyManaged: false };
    }
    if (field !== IMPLICIT_FIELD && isManagedField(field)) {
      return { text: '', fullyManaged: true };
    }
    return { text: src.slice(span.start, span.end), fullyManaged: false };
  }

  if (isNodeRangedTerm(node)) {
    const span = rangeClauseSpan(node, src);
    if (!span) return { text: '', fullyManaged: false };
    const field = decodeFieldName(node.field);
    // Negated ranges (NOT duration:[...]) are not representable in FilterState
    // and must be preserved verbatim even when the field is otherwise managed.
    if (!negate && field !== IMPLICIT_FIELD && isManagedField(field)) {
      return { text: '', fullyManaged: true };
    }
    return { text: src.slice(span.start, span.end), fullyManaged: false };
  }

  if (isLeftOnlyAST(node)) {
    const nodeNegate = negate !== (node.start === 'NOT');
    const inner = renderNode(node.left, src, isManagedField, nodeNegate);
    if (inner.fullyManaged) {
      return { text: '', fullyManaged: true };
    }
    const prefix = node.start ? `${node.start} ` : '';
    return {
      text: inner.text ? `${prefix}${inner.text}` : '',
      fullyManaged: false,
    };
  }

  if (isBinaryAST(node)) {
    // Field-group syntax: ServiceName:("api" OR "web").  The parser attaches
    // a non-implicit `field` to the BinaryAST wrapper (Bug 3).  When the group
    // field is managed we discard the whole group; otherwise we preserve the
    // raw source including the "Field:" prefix.
    const groupField =
      'field' in node &&
      typeof node.field === 'string' &&
      node.field !== IMPLICIT_FIELD
        ? decodeFieldName(node.field)
        : null;

    if (groupField) {
      if (isManagedField(groupField)) {
        return { text: '', fullyManaged: true };
      }
      // Preserve raw source.  The field-group span starts at the field's
      // fieldLocation and ends after the closing ')'.
      const fl =
        'fieldLocation' in node
          ? (node.fieldLocation as
              | { start?: { offset?: number }; end?: { offset?: number } }
              | null
              | undefined)
          : undefined;
      const groupStart = fl?.start?.offset;
      if (groupStart == null) return { text: '', fullyManaged: false };
      // Find the closing ')' of the paren group.
      let depth = 0;
      let groupEnd = -1;
      for (let i = groupStart; i < src.length; i++) {
        if (src[i] === '(') depth++;
        else if (src[i] === ')') {
          depth--;
          if (depth === 0) {
            groupEnd = i + 1;
            break;
          }
        }
      }
      if (groupEnd === -1) return { text: '', fullyManaged: false };
      return {
        text: src.slice(groupStart, groupEnd).trimEnd(),
        fullyManaged: false,
      };
    }

    const startOp: string | undefined =
      'start' in node && typeof node.start === 'string'
        ? node.start
        : undefined;
    const leftNegate = negate !== (startOp === 'NOT');
    const rightNegate =
      negate !== (node.operator === 'AND NOT' || node.operator === 'OR NOT');
    const left = renderNode(node.left, src, isManagedField, leftNegate);
    const right = renderNode(node.right, src, isManagedField, rightNegate);
    if (left.fullyManaged && right.fullyManaged) {
      return { text: '', fullyManaged: true };
    }
    const operator =
      node.operator === '<implicit>' ? ' ' : ` ${node.operator} `;
    const combined = [left.text, right.text].filter(Boolean).join(operator);
    // Bug 1 fix: the `start` field carries a leading operator like `NOT` that
    // the grammar placed on the outer binary node rather than a LeftOnlyAST.
    // Re-emit it so `NOT term AND ...` is not silently stripped to `term AND ...`.
    const startPrefix = 'start' in node && node.start ? `${node.start} ` : '';
    const text = node.parenthesized && combined ? `(${combined})` : combined;
    return {
      text: startPrefix && text ? `${startPrefix}${text}` : text,
      fullyManaged: false,
    };
  }

  return { text: '', fullyManaged: false };
}

/**
 * Returns true when the Lucene text contains a top-level OR operator (i.e. an
 * OR that is not inside parentheses or quoted strings). Used to decide whether
 * the residual must be wrapped in parens before joining it with AND — without
 * the wrapping, `a OR b AND c:"v"` would be mis-parsed as `a OR (b AND c:"v")`.
 *
 * Bug 9 fix: the original implementation counted bare `(` / `)` characters
 * without skipping quoted strings, so a `)` inside a quoted value like
 * `"timeout)"` decremented the paren depth and corrupted the subsequent scan.
 */
function hasTopLevelOr(text: string): boolean {
  let parenDepth = 0;
  let inQuote = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '\\' && inQuote) {
      // Skip escaped character inside a quoted string.
      i++;
      continue;
    }
    if (ch === '"') {
      inQuote = !inQuote;
      continue;
    }
    if (inQuote) continue;
    if (ch === '(') {
      parenDepth++;
      continue;
    }
    if (ch === ')') {
      parenDepth--;
      continue;
    }
    if (parenDepth === 0 && text.slice(i, i + 4).toUpperCase() === ' OR ') {
      return true;
    }
  }
  return false;
}

/**
 * Returns true when the SQL text contains a top-level OR operator (i.e. an OR
 * that is not inside parentheses, single-quoted strings, or backtick-quoted
 * identifiers). Used to decide whether the residual must be wrapped in parens
 * before joining it with AND — without the wrapping, `a = 1 OR b = 2 AND c IN
 * ('v')` would be mis-parsed as `a = 1 OR (b = 2 AND c IN ('v'))`.
 *
 * fix: the original check matched only the literal 4-char sequence
 * ' OR ' (single spaces), so `a = 1\nOR b = 2` was not detected as containing
 * a top-level OR and the residual was not parenthesized — producing the exact
 * mis-parse the function's docstring warns about. The check now matches any
 * whitespace-surrounded OR keyword (`\s+OR\s+`), consistent with the fix
 * applied to splitSqlConjuncts for the same class of issue.
 */
function hasTopLevelOrSql(text: string): boolean {
  let parenDepth = 0;
  let inString = false;
  let inBacktick = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (ch === "'") {
        const esc = handleQuoteEscape(text, i);
        if (esc.skip) {
          i = esc.next;
          continue;
        }
        inString = false;
      }
      continue;
    }
    if (inBacktick) {
      if (ch === '`') inBacktick = false;
      continue;
    }
    if (ch === "'") {
      inString = true;
      continue;
    }
    if (ch === '`') {
      inBacktick = true;
      continue;
    }
    if (ch === '(') {
      parenDepth++;
      continue;
    }
    if (ch === ')') {
      parenDepth--;
      continue;
    }
    if (parenDepth === 0 && /[\s]/.test(ch)) {
      // Skip whitespace, then check for OR keyword followed by whitespace.
      let j = i;
      while (j < text.length && /[\s]/.test(text[j])) j++;
      if (
        text.slice(j, j + 2).toUpperCase() === 'OR' &&
        j + 2 < text.length &&
        /[\s]/.test(text[j + 2])
      ) {
        return true;
      }
      // Advance i to avoid re-scanning the same whitespace. The loop's own
      // i++ will land on the char after the whitespace run.
      i = j - 1;
    }
  }
  return false;
}

/**
 * Replace the facet clauses in a Lucene `where` clause with a new FilterState.
 *
 * Only clauses matching the facet grammar (quoted `field:"v"`, `-field:"v"`,
 * `field:[a TO b]`) are touched. Free-text and unrecognized query content is
 * preserved from the original text, with connectors rebuilt so no dangling
 * `AND`/`OR`/parens are left behind. The new clauses are appended after the
 * residual text.
 */
function replaceLuceneFacetClauses(
  whereText: string,
  newState: FilterState,
  emitLanguage: 'lucene' | 'sql' | undefined,
  escapeKey: ((key: string) => string) | undefined,
  dateTimeColumns: ReadonlyMap<string, string> | undefined,
): string {
  if (!whereText.trim()) {
    return filterStateToWhereClause(newState, {
      language: emitLanguage ?? 'lucene',
      escapeKey,
      dateTimeColumns,
    });
  }

  let ast: lucene.AST;
  try {
    ast = parse(whereText);
  } catch {
    // Invalid Lucene — the query text is incomplete/mid-edit. Rather than
    // silently no-oping the caller's rewrite, emit the new state fresh so a
    // sidebar click still applies and replaces the broken text.
    return filterStateToWhereClause(newState, {
      language: emitLanguage ?? 'lucene',
      escapeKey,
      dateTimeColumns,
    });
  }

  // Build the set of fields renderNode is allowed to prune.
  //
  // we must NOT prune a field whose only representation in the
  // query is an unquoted / wildcard / comparison term (e.g. `ServiceName:api*`
  // or `Duration:>100`) when newState does NOT contain that field.  Previously,
  // collectFromAst added those fields to managedFields unconditionally, so a
  // sidebar click for a *different* field (e.g. SeverityText) would cause
  // renderNode to silently delete `ServiceName:api*` even though the caller
  // never asked for it to be removed.
  //
  // Fields that have a faithfully round-trippable representation (quoted terms
  // or ranges) are always pruneable — the caller depends on this for the
  // "drop field" use-case (e.g. removing `host:"a"` when host is absent from
  // newState). Fields that appear in the text *only* as unquoted / wildcard /
  // comparison terms cannot be faithfully represented in FilterState, so we
  // only prune them when the caller is explicitly replacing them (i.e. they
  // are present in newState).
  const collectedTerms: CollectedTerm[] = [];
  const collectedRanges: CollectedRange[] = [];
  const allFieldsInQuery = new Set<string>();
  collectFromAst(ast, collectedTerms, collectedRanges, allFieldsInQuery);

  // Fields that have at least one faithfully representable value (quoted or range).
  const representableFields = new Set<string>([
    ...collectedTerms.map(t => t.field),
    ...collectedRanges.map(r => r.field),
  ]);
  const newStateFields = new Set(Object.keys(newState));

  // A field is prunable when:
  //   (a) it has a round-trippable representation (always prunable — supports
  //       the "drop field" use-case), OR
  //   (b) it only appears as an unquoted/wildcard/comparison term AND the
  //       caller is explicitly replacing it via newState.
  const managedFields = new Set<string>(
    [...allFieldsInQuery].filter(
      f => representableFields.has(f) || newStateFields.has(f),
    ),
  );
  const residual = renderNode(ast, whereText, field =>
    managedFields.has(field),
  ).text;
  const newClauses = filterStateToWhereClause(newState, {
    language: emitLanguage ?? 'lucene',
    escapeKey,
    dateTimeColumns,
  });

  const trimmedResidual = residual.trim();
  if (!trimmedResidual) return newClauses;
  if (!newClauses) return trimmedResidual;
  // If the residual contains a top-level OR operator it must be parenthesized
  // before joining with AND, otherwise `a OR b AND c:"v"` would be parsed as
  // `a OR (b AND c:"v")` — narrowing the OR branch incorrectly.
  const safeResidual = hasTopLevelOr(trimmedResidual)
    ? `(${trimmedResidual})`
    : trimmedResidual;
  return `${safeResidual} AND ${newClauses}`;
}

/**
 * Split a SQL `where` string into top-level conjuncts, splitting on `AND`
 * (surrounded by any whitespace — spaces, tabs, newlines) outside quotes and
 * parentheses. The `AND` that belongs to a `BETWEEN ... AND ...` range is not
 * a separator, so a BETWEEN conjunct stays intact.
 *
 * fix: the original implementation only matched the literal 5-char
 * sequence ` AND ` (single space on each side), so a newline before or after
 * AND (e.g. `Body LIKE '%x%'\nAND ServiceName IN ('api')`) was not treated as
 * a separator. The entire multi-line expression was returned as a single
 * conjunct, which then couldn't be parsed as a facet predicate, so
 * `replaceSqlFacetClauses` left the whole text as residual and appended the
 * new clause — duplicating the query on every sidebar click.
 */
function splitSqlConjuncts(text: string): string[] {
  const conjuncts: string[] = [];
  let current = '';
  let inString = false;
  let inBacktick = false;
  let parenDepth = 0;
  let sawBetween = false;

  /**
   * Starting at position `i` in `text`, if the text matches
   * `\s+ AND \s` (whitespace, the keyword AND, at least one more whitespace
   * character) case-insensitively, return the index of the character
   * immediately after the AND keyword (i.e. the first whitespace of the
   * trailing run). Returns -1 when there is no match.
   *
   * The trailing whitespace is deliberately *not* consumed here: the main loop
   * re-processes it naturally, so the next conjunct is trimmed on push.
   */
  function matchAndSeparator(pos: number): number {
    if (pos >= text.length) return -1;
    // Must start with at least one whitespace character.
    if (!/[\s]/.test(text[pos])) return -1;
    let j = pos;
    while (j < text.length && /[\s]/.test(text[j])) j++;
    // Must be followed by AND (case-insensitive).
    if (text.slice(j, j + 3).toUpperCase() !== 'AND') return -1;
    // The character after AND must be whitespace (guards against matching
    // inside identifiers like CANDIDATE or COMMAND).
    if (j + 3 >= text.length || !/[\s]/.test(text[j + 3])) return -1;
    // Return the index of the first char after AND.
    return j + 3;
  }

  for (let i = 0; i < text.length; i++) {
    const char = text[i];

    // Backtick-quoted identifiers (e.g. `it's`) are opaque: a `'` or `(` inside
    // them is literal and must not toggle string state or paren depth.
    if (inBacktick) {
      if (char === '`') inBacktick = false;
      current += char;
      continue;
    }

    if (isQuoteBoundary(text, i)) {
      if (inString) {
        const esc = handleQuoteEscape(text, i);
        if (esc.skip) {
          current += "''";
          i = esc.next;
          continue;
        }
      }
      inString = !inString;
      current += char;
      continue;
    }

    if (inString) {
      current += char;
      continue;
    }

    if (char === '`') {
      inBacktick = true;
      current += char;
      continue;
    }

    if (char === '(') {
      parenDepth++;
      current += char;
      continue;
    }
    if (char === ')') {
      parenDepth--;
      current += char;
      continue;
    }

    if (parenDepth > 0) {
      current += char;
      continue;
    }

    // BETWEEN detection: the keyword can be followed by any whitespace.
    // We check for `BETWEEN` followed by at least one whitespace character so
    // we don't accidentally match a column name that starts with BETWEEN.
    if (
      !sawBetween &&
      text.slice(i, i + 7).toUpperCase() === 'BETWEEN' &&
      i + 7 < text.length &&
      /[\s]/.test(text[i + 7])
    ) {
      sawBetween = true;
      // Consume the keyword (the leading char is `char`; advance i to the end
      // of `BETWEEN` so the loop's i++ lands on the trailing whitespace).
      current += text.slice(i, i + 7);
      i += 6;
      continue;
    }

    // AND separator detection: any whitespace + AND + any whitespace.
    const afterAnd = matchAndSeparator(i);
    if (afterAnd !== -1) {
      if (sawBetween) {
        // The range's own AND — not a conjunct separator.
        sawBetween = false;
        // Re-emit as a single normalised space so the conjunct stays intact.
        current += ' AND ';
        i = afterAnd; // land on first char of trailing whitespace (will be trimmed)
        continue;
      }
      if (current.trim()) {
        conjuncts.push(current.trim());
      }
      current = '';
      i = afterAnd; // skip to char after AND; trailing whitespace trimmed on push
      continue;
    }

    current += char;
  }

  if (current.trim()) {
    conjuncts.push(current.trim());
  }
  return conjuncts;
}

// Strip SQL comments (`-- ...` line comments and `/* ... */` block comments)
// from a WHERE string, returning the code with each comment replaced by a single
// space plus the collected comment texts. Comments inside single-quoted strings
// or backtick-quoted identifiers are literal text and are left untouched.
// Stripping comments before conjunct splitting keeps a commented-out ` AND `
// from being treated as a real separator, and lets the caller re-append the
// comments at the end instead of letting a facet predicate land inside one.
function stripSqlComments(text: string): {
  code: string;
  comments: string[];
} {
  let code = '';
  const comments: string[] = [];
  let inString = false;
  let inBacktick = false;

  for (let i = 0; i < text.length; i++) {
    if (inBacktick) {
      code += text[i];
      if (text[i] === '`') inBacktick = false;
      continue;
    }
    if (inString) {
      if (isQuoteBoundary(text, i)) {
        const esc = handleQuoteEscape(text, i);
        if (esc.skip) {
          code += "''";
          i = esc.next;
          continue;
        }
        inString = false;
      }
      code += text[i];
      continue;
    }
    if (text[i] === "'") {
      inString = true;
      code += text[i];
      continue;
    }
    if (text[i] === '`') {
      inBacktick = true;
      code += text[i];
      continue;
    }
    if (text[i] === '-' && text[i + 1] === '-') {
      let comment = '--';
      i += 2;
      while (i < text.length && text[i] !== '\n') {
        comment += text[i];
        i++;
      }
      comments.push(comment);
      code += ' ';
      i--; // the \n (or end) will be consumed by the loop's own increment
      continue;
    }
    if (text[i] === '/' && text[i + 1] === '*') {
      let comment = '/*';
      i += 2;
      while (i < text.length) {
        if (text[i] === '*' && text[i + 1] === '/') {
          comment += '*/';
          i += 2;
          break;
        }
        comment += text[i];
        i++;
      }
      comments.push(comment);
      code += ' ';
      i--; // let the loop's increment advance past the closing '/' (or end)
      continue;
    }
    code += text[i];
  }

  return { code, comments };
}

/**
 * Replace the facet clauses in a SQL `where` clause with a new FilterState.
 *
 * Top-level conjuncts that parse as a single facet predicate (`<key> IN
 * (...)`, `<key> NOT IN (...)`, `<key> BETWEEN ... AND ...`) for a field being
 * written are dropped and re-emitted from `newState`; everything else is
 * preserved. `escapeKey` maps clean keys to the quoted ClickHouse expressions
 * used both to match existing conjuncts and to emit new ones.
 */
function replaceSqlFacetClauses(
  whereText: string,
  newState: FilterState,
  escapeKey: ((key: string) => string) | undefined,
  dateTimeColumns: ReadonlyMap<string, string> | undefined,
  emitLanguage?: 'lucene' | 'sql',
): string {
  const clean = whereText.trim();
  // Strip SQL comments up front so a commented-out ` AND ` is not mistaken for
  // a real conjunct separator, and re-append them at the end so newly emitted
  // facet predicates never land inside a comment.
  const { code, comments } = stripSqlComments(clean);
  const commentSuffix = comments.length ? ` ${comments.join(' ')}` : '';
  const emit = () =>
    filterStateToWhereClause(newState, {
      language: emitLanguage ?? 'sql',
      escapeKey,
      dateTimeColumns,
    });

  if (!code.trim()) return `${emit()}${commentSuffix}`;

  const kept: string[] = [];
  // Build the set of clean keys being managed (present in the original text as
  // parseable facets) so we drop ALL of them and re-emit only those in newState.
  // This lets the caller clear a field from the filter by omitting it from
  // newState, and also handles the case where newState is empty (clear all).
  //
  // A key is only managed when it appears *exactly once* as a facet conjunct.
  // If the same key appears in multiple conjuncts (e.g. `host IN ('a') AND host
  // IN ('b')`) the user intentionally wrote a conjunction of two IN lists.
  // Merging them into one IN list would change the semantics (intersection →
  // union for scalar columns), so we leave both conjuncts untouched instead.
  const keyCount = new Map<string, number>();
  for (const conjunct of splitSqlConjuncts(code)) {
    if (!conjunct.trim()) continue;
    const upper = conjunct.toUpperCase();
    const isFacet =
      upper.includes(' IN (') ||
      upper.includes(' NOT IN (') ||
      upper.includes(' BETWEEN ');
    if (!isFacet) continue;
    const filter: Filter = { type: 'sql', condition: conjunct };
    if (isRenderablePinnedFilter(filter)) {
      const parsedKey = Object.keys(parseQuery([filter]).filters)[0];
      if (parsedKey !== undefined) {
        keyCount.set(parsedKey, (keyCount.get(parsedKey) ?? 0) + 1);
      }
    }
  }
  // All keys that appear as facet conjuncts are managed (eligible for
  // replacement). The previous `count === 1` guard was intended to avoid
  // changing the semantics of a hand-written conjunction like
  // `host IN ('a') AND host IN ('b')`, but it caused the sidebar to append
  // a third predicate instead of replacing both — leaving the old restrictions
  // active and causing the sidebar selection to return zero rows. Replacing all
  // conjuncts for a field (however many there are) is the correct behaviour:
  // the sidebar owns every facet it can parse, and duplicate IN lists are an
  // unusual/erroneous state that replacement should clean up, not preserve.
  const managedKeys = new Set<string>(keyCount.keys());

  for (const conjunct of splitSqlConjuncts(code)) {
    if (!conjunct.trim()) continue;
    const upper = conjunct.toUpperCase();
    const isFacet =
      upper.includes(' IN (') ||
      upper.includes(' NOT IN (') ||
      upper.includes(' BETWEEN ');
    if (!isFacet) {
      kept.push(conjunct);
      continue;
    }
    const filter: Filter = { type: 'sql', condition: conjunct };
    // Drop this conjunct if it maps to a managed field — it will be re-emitted
    // from newState (or omitted entirely if newState doesn't include that field).
    if (isRenderablePinnedFilter(filter)) {
      const parsedKey = Object.keys(parseQuery([filter]).filters)[0];
      if (parsedKey !== undefined && managedKeys.has(parsedKey)) {
        continue; // will be re-emitted from newState (or dropped if not there)
      }
    }
    kept.push(conjunct);
  }

  const residual = kept.join(' AND ');
  const newClauses = emit();
  if (!residual) return `${newClauses}${commentSuffix}`;
  if (!newClauses) return `${residual}${commentSuffix}`;
  // when the emit language differs from the source language (i.e.,
  // we are translating SQL → Lucene), the residual is SQL syntax and the new
  // clauses are Lucene syntax. Joining them produces a syntactically mixed
  // string that is neither valid SQL nor valid Lucene. In that case, return
  // only the residual (preserving the original non-facet content verbatim) and
  // discard the new clauses — the caller must handle the translation at a higher
  // level, or the user must re-type the non-facet portion.
  if (emitLanguage != null && emitLanguage !== 'sql') {
    return `${residual}${commentSuffix}`;
  }
  // If the residual contains a top-level OR operator it must be parenthesized
  // before joining with AND, otherwise `a = 1 OR b = 2 AND c IN ('v')` would be
  // parsed as `a = 1 OR (b = 2 AND c IN ('v'))` — narrowing the OR branch.
  const safeResidual = hasTopLevelOrSql(residual)
    ? `(${residual.trim()})`
    : residual;
  return `${safeResidual} AND ${newClauses}${commentSuffix}`;
}

/**
 * Replace the facet clauses in a `where` clause with a new FilterState, in the
 * given query language. Non-facet content (free-text, complex queries) is
 * preserved; only clauses matching the facet grammar are rewritten.
 *
 * This is the write half of the search page's unified sidebar-⇄-query-input
 * representation: sidebar toggles produce a FilterState, which replaces the
 * matching clauses in the query text instead of living in a separate `filters`
 * parameter.
 */
export function replaceFilterClauses(
  whereText: string,
  language: 'lucene' | 'sql',
  newState: FilterState,
  {
    escapeKey,
    dateTimeColumns,
    emitLanguage,
  }: {
    escapeKey?: (key: string) => string;
    dateTimeColumns?: ReadonlyMap<string, string>;
    /**
     * When set, the facets are re-emitted in this language instead of `language`.
     * Matching/pruning still happens in `language` (the source of the existing
     * text); `emitLanguage` only changes how the new clauses are written. Used
     * to translate a `where` clause from one query language to another while
     * preserving non-facet content.
     */
    emitLanguage?: 'lucene' | 'sql';
  } = {},
): string {
  if (language === 'lucene') {
    return replaceLuceneFacetClauses(
      whereText,
      newState,
      emitLanguage,
      escapeKey,
      dateTimeColumns,
    );
  }
  return replaceSqlFacetClauses(
    whereText,
    newState,
    escapeKey,
    dateTimeColumns,
    emitLanguage,
  );
}

/**
 * Append `newState`'s clauses to a `where` clause while preserving the existing
 * text verbatim. Unlike `replaceFilterClauses` (which treats the existing text's
 * facet fields as managed and re-emits only the new state's fields), this *merges*:
 * both the original clause and the new state's predicates are kept, joined with
 * AND.
 *
 * This is the semantics a legacy `where` + separate `filters` representation
 * needs when folding the filters into the unified `where`: the two were
 * independent predicates ANDed at query time, so neither may be dropped.
 *
 * The existing text is preserved verbatim (it is not re-emitted), so complex or
 * free-form content round-trips exactly. Only two adjustments are made to keep
 * the joined clause well-formed:
 *  - a top-level OR in the existing text is parenthesized before the AND join,
 *    so `a OR b AND c:"v"` is not mis-parsed as `a OR (b AND c:"v")`;
 *  - SQL comments in the existing text are moved to the end so the appended
 *    predicate does not land inside a `--` / `/* */
export function mergeFilterStateIntoWhereClause(
  whereText: string,
  language: 'lucene' | 'sql',
  newState: FilterState,
  {
    escapeKey,
    dateTimeColumns,
  }: {
    escapeKey?: (key: string) => string;
    dateTimeColumns?: ReadonlyMap<string, string>;
  } = {},
): string {
  const newClauses = filterStateToWhereClause(newState, {
    language,
    escapeKey,
    dateTimeColumns,
  });
  if (!whereText.trim()) return newClauses;
  if (!newClauses) return whereText.trim();

  if (language === 'sql') {
    const { code, comments } = stripSqlComments(whereText.trim());
    const residual = code.trim();
    const safeResidual = hasTopLevelOrSql(residual)
      ? `(${residual})`
      : residual;
    const commentSuffix = comments.length ? ` ${comments.join(' ')}` : '';
    return `${safeResidual} AND ${newClauses}${commentSuffix}`;
  }

  const safeWhere = hasTopLevelOr(whereText)
    ? `(${whereText.trim()})`
    : whereText.trim();
  return `${safeWhere} AND ${newClauses}`;
}

// Helper function to parse a string value as boolean if possible, or otherwise
// return as string with surrounding quotes removed and SQL-escaped quotes unescaped.
const getBooleanOrUnquotedString = (value: string): string | boolean => {
  const trimmed = value.trim();

  if (['true', 'false'].includes(trimmed.toLowerCase())) {
    return trimmed.toLowerCase() === 'true';
  }

  // Remove surrounding quotes and reverse the escape sequences produced by
  // filtersToQuery's escapeString. Order matters: collapse \\ → \ first so
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

// Check whether a SQL fragment contains a keyword or operator outside of
// single-quoted strings.  Accepts either single characters (=, <, >) or
// multi-character keywords (' OR ', ' BETWEEN ') to search for.
function containsOutsideQuotes(
  text: string,
  targets: (string | { char: string })[],
): boolean {
  let inString = false;
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

const SQL_IDENTIFIER_CHAR_REGEX = /[A-Za-z0-9_]/;

function containsSqlKeywordOutsideQuotes(
  text: string,
  keywords: string[],
): boolean {
  let inString = false;
  const upperKeywords = keywords.map(keyword => keyword.toUpperCase());

  for (let i = 0; i < text.length; i++) {
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

    for (const keyword of upperKeywords) {
      if (text.slice(i, i + keyword.length).toUpperCase() !== keyword) {
        continue;
      }
      const before = i > 0 ? text[i - 1] : '';
      const after =
        i + keyword.length < text.length ? text[i + keyword.length] : '';
      if (
        !SQL_IDENTIFIER_CHAR_REGEX.test(before) &&
        !SQL_IDENTIFIER_CHAR_REGEX.test(after)
      ) {
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

// Split a string on the first occurrence of `delimiter` that is outside
// single-quoted strings.  Returns [before, after] or null if not found.
function splitOnFirstOutsideQuotes(
  text: string,
  delimiter: string,
): [string, string] | null {
  let inString = false;
  const upper = delimiter.toUpperCase();
  for (let i = 0; i < text.length; i++) {
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
    if (text.slice(i, i + upper.length).toUpperCase() === upper) {
      return [text.slice(0, i), text.slice(i + upper.length)];
    }
  }
  return null;
}

function stripSqlWrappingParens(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith('(') || !trimmed.endsWith(')')) return null;

  let inString = false;
  let parenDepth = 0;

  for (let i = 0; i < trimmed.length; i++) {
    if (isQuoteBoundary(trimmed, i)) {
      if (inString) {
        const esc = handleQuoteEscape(trimmed, i);
        if (esc.skip) {
          i = esc.next;
          continue;
        }
      }
      inString = !inString;
      continue;
    }
    if (inString) continue;

    if (trimmed[i] === '(') {
      parenDepth++;
      continue;
    }
    if (trimmed[i] === ')') {
      parenDepth--;
      if (parenDepth === 0 && i < trimmed.length - 1) {
        return null;
      }
    }
  }

  return parenDepth === 0 ? trimmed.slice(1, -1).trim() : null;
}

function normalizeSqlFacetPart(part: string): {
  part: string;
  negated: boolean;
} {
  let trimmed = part.trim();
  let negated = false;

  const notMatch = trimmed.match(/^NOT\b/i);
  if (notMatch) {
    const afterNot = trimmed.slice(notMatch[0].length).trim();
    const unwrapped = stripSqlWrappingParens(afterNot);
    if (unwrapped != null) {
      trimmed = unwrapped;
      negated = true;
    }
  }

  let unwrapped = stripSqlWrappingParens(trimmed);
  while (unwrapped != null) {
    trimmed = unwrapped;
    unwrapped = stripSqlWrappingParens(trimmed);
  }

  return { part: trimmed, negated };
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

  // Split on ' AND ' while respecting quoted strings (including SQL-escaped quotes)
  const parts: string[] = [];
  let currentPart = '';
  let inString = false;

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

    if (!inString && condition.slice(i, i + 5).toUpperCase() === ' AND ') {
      if (currentPart.trim()) {
        parts.push(currentPart.trim());
      }
      currentPart = '';
      i += 4; // Skip past ' AND '
      continue;
    }

    currentPart += char;
  }

  if (currentPart.trim()) {
    parts.push(currentPart.trim());
  }

  // Process each part to extract IN/NOT IN clauses
  for (const part of parts) {
    const normalized = normalizeSqlFacetPart(part);
    const normalizedPart = normalized.part;

    // Skip parts that contain OR (not supported) or comparison operators,
    // but only when those operators appear outside of quoted strings.
    if (containsOperatorOutsideQuotes(normalizedPart)) {
      continue;
    }

    const isExclude = containsOutsideQuotes(normalizedPart, [' NOT IN ']);
    const hasIn = isExclude || containsOutsideQuotes(normalizedPart, [' IN ']);

    if (hasIn) {
      // Split on the first unquoted ' IN ' / ' NOT IN '
      const splitResult = splitOnFirstOutsideQuotes(
        normalizedPart,
        isExclude ? ' NOT IN ' : ' IN ',
      );
      if (!splitResult) continue;
      const [key, values] = splitResult;

      const keyStr = key.trim();
      const trimmedValues = values.trim();

      // A subquery (`col IN (SELECT ...)`) is not a facet: treating its inner
      // SQL as a plain value list would both render a bogus checkbox in the
      // sidebar and let `replaceSqlFacetClauses` destroy the subquery when
      // re-emitting the column. Reject any parenthesized list containing SQL
      // clause keywords outside quoted strings.
      if (
        containsSqlKeywordOutsideQuotes(trimmedValues, [
          'SELECT',
          'FROM',
          'WHERE',
          'GROUP',
          'ORDER',
          'UNION',
          'HAVING',
          'JOIN',
          'LIMIT',
          'DISTINCT',
        ])
      ) {
        continue;
      }

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
        isExclude: isExclude !== normalized.negated,
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

// Count top-level ` AND ` separators (outside quoted strings). Used to detect
// conjuncts the pinned-filter parser silently drops.
function countTopLevelAnd(condition: string): number {
  let count = 0;
  let inString = false;
  for (let i = 0; i < condition.length; i++) {
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
