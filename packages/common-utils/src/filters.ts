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
      clauses.push(
        `${luceneField}:[${values.range.min} TO ${values.range.max}]`,
      );
    }
  }
  return clauses.join(' AND ');
}

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
    // Implicit-field phrases (`"a b"`) are free-text search, not facets.
    if (field === IMPLICIT_FIELD) return;
    terms.push({ field, value: decodeSpecialTokens(ast.term), negated });
  } else if (isNodeRangedTerm(ast)) {
    const field = decodeSpecialTokens(ast.field);
    if (field === IMPLICIT_FIELD) return;
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
    return parseQuery([{ type: 'sql', condition: whereText }]).filters;
  }

  try {
    const ast = parse(whereText);
    const terms: CollectedTerm[] = [];
    const ranges: CollectedRange[] = [];
    collectFromAst(ast, terms, ranges);

    const byField = new Map<
      string,
      {
        included: Set<string | boolean>;
        excluded: Set<string | boolean>;
        range?: { min: number; max: number };
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
      const value = coerceBooleanValue(t.value);
      if (t.negated) {
        entry.excluded.add(value);
      } else {
        entry.included.add(value);
      }
    }
    for (const r of ranges) {
      const entry = getEntry(r.field);
      entry.range = { min: r.min, max: r.max };
    }
    return Object.fromEntries(byField);
  } catch {
    return {};
  }
}

type Span = { start: number; end: number };

function termClauseSpan(node: lucene.NodeTerm, src: string): Span | null {
  const tl = node.termLocation;
  if (!tl?.end) return null;
  const start = node.fieldLocation?.start?.offset ?? tl.start?.offset;
  if (start == null) return null;
  return { start, end: tl.end.offset };
}

function rangeClauseSpan(
  node: lucene.NodeRangedTerm,
  src: string,
): Span | null {
  const fl = node.fieldLocation;
  if (!fl?.start?.offset || !fl.end?.offset) return null;
  const endBracket = src.indexOf(']', fl.end.offset);
  if (endBracket === -1) return null;
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
 */
function renderNode(
  node: lucene.AST | lucene.Node,
  src: string,
  isManagedField: (field: string) => boolean,
): RenderResult {
  if (isNodeTerm(node)) {
    const span = termClauseSpan(node, src);
    if (!span) return { text: '', fullyManaged: false };
    if (!node.quoted) {
      return { text: src.slice(span.start, span.end), fullyManaged: false };
    }
    const field = decodeSpecialTokens(
      node.field.startsWith('-') ? node.field.slice(1) : node.field,
    );
    if (field !== IMPLICIT_FIELD && isManagedField(field)) {
      return { text: '', fullyManaged: true };
    }
    return { text: src.slice(span.start, span.end), fullyManaged: false };
  }

  if (isNodeRangedTerm(node)) {
    const span = rangeClauseSpan(node, src);
    if (!span) return { text: '', fullyManaged: false };
    const field = decodeSpecialTokens(node.field);
    if (field !== IMPLICIT_FIELD && isManagedField(field)) {
      return { text: '', fullyManaged: true };
    }
    return { text: src.slice(span.start, span.end), fullyManaged: false };
  }

  if (isLeftOnlyAST(node)) {
    const inner = renderNode(node.left, src, isManagedField);
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
    const left = renderNode(node.left, src, isManagedField);
    const right = renderNode(node.right, src, isManagedField);
    if (left.fullyManaged && right.fullyManaged) {
      return { text: '', fullyManaged: true };
    }
    const operator = node.operator === '<implicit>' ? '' : ` ${node.operator} `;
    const combined = [left.text, right.text].filter(Boolean).join(operator);
    return {
      text: node.parenthesized && combined ? `(${combined})` : combined,
      fullyManaged: false,
    };
  }

  return { text: '', fullyManaged: false };
}

/**
 * Returns true when the Lucene text contains a top-level OR operator (i.e. an
 * OR that is not inside parentheses). Used to decide whether the residual must
 * be wrapped in parens before joining it with AND — without the wrapping,
 * `a OR b AND c:"v"` would be mis-parsed as `a OR (b AND c:"v")`.
 */
function hasTopLevelOr(text: string): boolean {
  let parenDepth = 0;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '(') { parenDepth++; continue; }
    if (text[i] === ')') { parenDepth--; continue; }
    if (parenDepth === 0 && text.slice(i, i + 4).toUpperCase() === ' OR ') {
      return true;
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
): string {
  if (!whereText.trim()) {
    return filterStateToWhereClause(newState, { language: 'lucene' });
  }

  let ast: lucene.AST;
  try {
    ast = parse(whereText);
  } catch {
    // Invalid Lucene — don't clobber the user's text.
    return whereText;
  }

  // Managed fields are every facet field currently present in the text, so a
  // caller that intentionally drops a field (e.g. source-change cleanup) also
  // removes its clauses rather than leaving them to resurface.
  const managed = new Set(
    Object.keys(parseWhereClauseToFilterState(whereText, 'lucene')),
  );
  const residual = renderNode(ast, whereText, field => managed.has(field)).text;
  const newClauses = filterStateToWhereClause(newState, {
    language: 'lucene',
  });

  const trimmedResidual = residual.trim();
  if (!trimmedResidual) return newClauses;
  if (!newClauses) return trimmedResidual;
  // If the residual contains a top-level OR operator it must be parenthesized
  // before joining with AND, otherwise `a OR b AND c:"v"` would be parsed as
  // `a OR (b AND c:"v")` — narrowing the OR branch incorrectly.
  const safeResidual = hasTopLevelOr(residual)
    ? `(${trimmedResidual})`
    : trimmedResidual;
  return `${safeResidual} AND ${newClauses}`;
}

/**
 * Split a SQL `where` string into top-level conjuncts, splitting on ` AND `
 * outside quotes and parentheses. The ` AND ` that belongs to a `BETWEEN ...
 * AND ...` range is not a separator, so a BETWEEN conjunct stays intact.
 */
function splitSqlConjuncts(text: string): string[] {
  const conjuncts: string[] = [];
  let current = '';
  let inString = false;
  let parenDepth = 0;
  let sawBetween = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];

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

    if (inString || parenDepth > 0) {
      current += char;
      continue;
    }

    if (!sawBetween && text.slice(i, i + 8).toUpperCase() === 'BETWEEN ') {
      sawBetween = true;
      current += 'BETWEEN ';
      i += 7;
      continue;
    }

    if (text.slice(i, i + 5).toUpperCase() === ' AND ') {
      if (sawBetween) {
        // The range's own `AND` — not a conjunct separator.
        sawBetween = false;
        current += ' AND ';
        i += 4;
        continue;
      }
      if (current.trim()) {
        conjuncts.push(current.trim());
      }
      current = '';
      i += 4;
      continue;
    }

    current += char;
  }

  if (current.trim()) {
    conjuncts.push(current.trim());
  }
  return conjuncts;
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
): string {
  const clean = whereText.trim();
  const emit = () =>
    filterStateToWhereClause(newState, {
      language: 'sql',
      escapeKey,
      dateTimeColumns,
    });

  if (!clean) return emit();

  const kept: string[] = [];
  // Build the set of clean keys being written so we only drop conjuncts whose
  // field is being replaced — not every parseable facet in the where clause.
  const replacedKeys = new Set(Object.keys(newState));

  for (const conjunct of splitSqlConjuncts(clean)) {
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
    // Only drop this conjunct if it maps to a field we are replacing.
    // Compound conditions and unparseable conjuncts are always preserved.
    if (isRenderablePinnedFilter(filter)) {
      const parsedKey = Object.keys(parseQuery([filter]).filters)[0];
      if (parsedKey !== undefined && replacedKeys.has(parsedKey)) {
        continue; // will be re-emitted from newState
      }
    }
    kept.push(conjunct);
  }

  const residual = kept.join(' AND ');
  const newClauses = emit();
  if (!residual) return newClauses;
  if (!newClauses) return residual;
  return `${residual} AND ${newClauses}`;
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
  }: {
    escapeKey?: (key: string) => string;
    dateTimeColumns?: ReadonlyMap<string, string>;
  } = {},
): string {
  if (language === 'lucene') {
    return replaceLuceneFacetClauses(whereText, newState);
  }
  return replaceSqlFacetClauses(
    whereText,
    newState,
    escapeKey,
    dateTimeColumns,
  );
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
    // Skip parts that contain OR (not supported) or comparison operators,
    // but only when those operators appear outside of quoted strings.
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
