import {
  parseKeyPath,
  quoteIdentifierIfNeeded,
} from '@hyperdx/common-utils/dist/core/metadata';
import { splitAndTrimWithBracket } from '@hyperdx/common-utils/dist/core/utils';
import { SourceKind, TSource } from '@hyperdx/common-utils/dist/types';

import { cleanClickHouseExpression } from '@/components/DBSearchPageFilters/utils';
import { isKeyCompatibleWithColumns } from '@/searchFilters';
import { mergePath } from '@/utils';

// The `groupBy` URL param: absent (null) means the source default, an empty
// string means no grouping, anything else is a comma-separated SQL list.
export type SearchGroupByParam = string | null;

// The source fields the default group by reads; any TSource satisfies it.
type GroupBySource = Pick<TSource, 'kind'> & {
  severityTextExpression?: string;
  statusCodeExpression?: string;
};

export function formatGroupByFields(fields: string[]): string {
  return fields.join(', ');
}

// A field path as group-by SQL. mergePath leaves the root column bare, so a
// name like `dash-column` would otherwise render as a subtraction.
export function toGroupByField(
  path: string[],
  jsonColumns: string[],
  mapColumns: string[],
): string {
  const [root] = path;
  const merged = mergePath(path, jsonColumns, mapColumns);
  return quoteIdentifierIfNeeded(root) + merged.slice(root.length);
}

export function defaultSearchGroupBy(
  source?: GroupBySource,
): string | undefined {
  switch (source?.kind) {
    case SourceKind.Log:
      return source.severityTextExpression;
    case SourceKind.Trace:
      return source.statusCodeExpression;
    default:
      return undefined;
  }
}

export function resolveSearchGroupBy(
  param: SearchGroupByParam,
  source?: GroupBySource,
): string | undefined {
  if (param == null) return defaultSearchGroupBy(source);
  return param.trim() || undefined;
}

// Whether the histogram is grouped by something other than the source default,
// including an explicit param that spells out the default.
export function isCustomSearchGroupBy(
  param: SearchGroupByParam,
  source?: GroupBySource,
): boolean {
  const resolved = resolveSearchGroupBy(param, source);
  if (resolved == null) return false;
  const normalize = (expr: string) =>
    formatGroupByFields(splitAndTrimWithBracket(expr));
  return normalize(resolved) !== normalize(defaultSearchGroupBy(source) ?? '');
}

/**
 * Applies the sidebar filters' column rule to each group-by expression, so
 * expressions that aren't a column path (e.g. `concat(a, b)`) are dropped.
 * Nothing kept → `null`, so the new source's default applies.
 */
export function retainGroupByByColumns(
  param: SearchGroupByParam,
  allowedColumnNames: Set<string>,
): { kept: SearchGroupByParam; dropped: string[] } {
  if (param == null || param.trim() === '') {
    return { kept: param, dropped: [] };
  }
  const kept: string[] = [];
  const dropped: string[] = [];
  for (const field of splitAndTrimWithBracket(param)) {
    const key = parseKeyPath(cleanClickHouseExpression(field)).join('.');
    (isKeyCompatibleWithColumns(key, allowedColumnNames) ? kept : dropped).push(
      field,
    );
  }
  if (dropped.length === 0) return { kept: param, dropped };
  return {
    kept: kept.length > 0 ? formatGroupByFields(kept) : null,
    dropped,
  };
}
