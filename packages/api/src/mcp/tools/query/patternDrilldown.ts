import type { Metadata } from '@hyperdx/common-utils/dist/core/metadata';
import { escapeSqlString } from '@hyperdx/common-utils/dist/core/utils';
import {
  CustomSchemaSQLSerializerV2,
  SearchQueryBuilder,
} from '@hyperdx/common-utils/dist/queryParser';
import type {
  ChartVariable,
  UseTextIndex,
} from '@hyperdx/common-utils/dist/types';
import { substituteVariables } from '@hyperdx/common-utils/dist/variables';

const PATTERN_WILDCARD = '<*>';

/**
 * Templates longer than this get no predicate: the regex (and the SQL that
 * embeds it) would be unwieldy, and very long templates are usually a
 * single unparameterized payload rather than a reusable shape.
 */
export const MAX_PREDICATE_TEMPLATE_LENGTH = 4000;

export const PATTERN_MATCH_SEMANTICS =
  'whereSnippet matches values with the same whitespace-separated token count as the ' +
  'template, the same literal tokens (case-sensitive) in the same positions, and exactly ' +
  'one non-whitespace token at each <*>. Every sampled member of the cluster matches. ' +
  'It can also match unsampled events whose shape fits, including ones Drain would have ' +
  'put in a more specific cluster, so the drill-down is a superset of cluster membership.';

// Drain tokenizes with JS `\s`, which includes Unicode spaces and BOM; RE2's
// `\s` is ASCII-only. JS `\s` = RE2 `\s` + \v + \pZ (Zs/Zl/Zp) + BOM. `\pZ`
// keeps the snippet short; spelling out the code points repeats ~100 chars
// between every token.
const JS_WHITESPACE = '\\s\\x{0B}\\pZ\\x{FEFF}';
const WS = `[${JS_WHITESPACE}]`;
const NON_WS = `[^${JS_WHITESPACE}]`;

function escapeRe2Literal(token: string): string {
  return token.replace(/[\\^$.|?*+()[\]{}]/g, '\\$&');
}

/** Anchored RE2 regex that a value matches when it fits the Drain template. */
export function templateToRegex(template: string): string {
  const tokens = template.split(/\s+/).filter(t => t.length > 0);
  const body = tokens
    .map(t => (t === PATTERN_WILDCARD ? `${NON_WS}+` : escapeRe2Literal(t)))
    .join(`${WS}+`);
  return `^${WS}*${body}${WS}*$`;
}

/**
 * SQL predicate selecting events whose `valueExpression` fits the template,
 * or null when the template is too long to turn into a predicate.
 */
export function buildPatternPredicate(
  valueExpression: string,
  template: string,
): string | null {
  if (template.length > MAX_PREDICATE_TEMPLATE_LENGTH) return null;
  return `match(${valueExpression}, '${escapeSqlString(templateToRegex(template))}')`;
}

/** AND together SQL conditions, skipping blanks. */
export function andSql(...conditions: Array<string | undefined>): string {
  const parts = conditions.filter(
    (c): c is string => c != null && c.trim() !== '',
  );
  if (parts.length <= 1) return parts[0] ?? '';
  return parts.map(c => `(${c})`).join(' AND ');
}

/**
 * Render the caller's filter as SQL so it can be ANDed with a pattern
 * predicate in one clickstack_search `where`. Dashboard variables are
 * expanded first because the search tool has no variable context.
 */
export async function userWhereAsSql({
  where,
  whereLanguage,
  variables,
  metadata,
  databaseName,
  tableName,
  connectionId,
  implicitColumnExpression,
  useTextIndexForImplicitColumn,
}: {
  where: string;
  whereLanguage: 'lucene' | 'sql';
  variables?: ChartVariable[];
  metadata: Metadata;
  databaseName: string;
  tableName: string;
  connectionId: string;
  implicitColumnExpression?: string;
  useTextIndexForImplicitColumn?: UseTextIndex;
}): Promise<string> {
  if (!where.trim()) return '';
  const expanded = variables
    ? substituteVariables(where, { variables, inputLanguage: whereLanguage })
    : where;
  if (whereLanguage === 'sql') return expanded;
  const serializer = new CustomSchemaSQLSerializerV2({
    metadata,
    databaseName,
    tableName,
    connectionId,
    implicitColumnExpression,
    useTextIndexForImplicitColumn,
  });
  return new SearchQueryBuilder(expanded, serializer).build();
}
