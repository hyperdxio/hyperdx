import { escapeSqlString } from '@hyperdx/common-utils/dist/core/utils';
import type { Filter } from '@hyperdx/common-utils/dist/types';

/** Drain3's placeholder for a token that varied across clustered events. */
const DRAIN_WILDCARD = '<*>';

export function buildPatternColumnExpression({
  patternColumn,
  fallback,
}: {
  patternColumn: string | null | undefined;
  fallback: string;
}): string {
  if (!patternColumn) return fallback;
  return `toString(${patternColumn})`;
}

/**
 * Turn a Drain template into a ClickHouse LIKE pattern. Literal `%`, `_` and
 * `\` are escaped so they cannot act as wildcards; each `<*>` becomes `%`.
 */
export function drainTemplateToLikePattern(template: string): string {
  return template.split(DRAIN_WILDCARD).map(escapeLikeLiteral).join('%');
}

function escapeLikeLiteral(value: string): string {
  return value
    .replaceAll('\\', '\\\\')
    .replaceAll('%', '\\%')
    .replaceAll('_', '\\_');
}

export function patternMatchSqlCondition(
  bodyValueExpression: string,
  template: string,
): string | null {
  const expr = bodyValueExpression.trim();
  const pattern = template.trim();
  if (!expr || !pattern) return null;
  const like = drainTemplateToLikePattern(pattern);
  // A template that is only wildcards would match every row.
  if (like.replaceAll('%', '') === '') return null;
  return `${expr} LIKE '${escapeSqlString(like)}'`;
}

export function andSqlWhere(existing: string, extra: string): string {
  const a = existing.trim();
  const b = extra.trim();
  if (!a) return b;
  if (!b) return a;
  return `(${a}) AND (${b})`;
}

/**
 * Fold a pattern-match predicate into the current search. SQL WHERE is the
 * typed box, so a LIKE belongs there. Lucene WHERE cannot carry it, so it
 * rides along as an extra SQL filter instead of replacing the Lucene text.
 */
export function nextSearchForPatternMatch({
  where,
  whereLanguage,
  filters,
  sqlCondition,
}: {
  where: string;
  whereLanguage?: 'sql' | 'lucene';
  filters: Filter[];
  sqlCondition: string;
}): { where: string; filters: Filter[] } {
  if (whereLanguage === 'lucene') {
    return {
      where,
      filters: [...filters, { type: 'sql', condition: sqlCondition }],
    };
  }
  return { where: andSqlWhere(where, sqlCondition), filters };
}
