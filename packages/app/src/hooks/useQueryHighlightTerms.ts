import { useMemo } from 'react';
import { extractLuceneHighlightTerms } from '@hyperdx/common-utils/dist/queryParser';
import {
  SearchCondition,
  SearchConditionLanguage,
} from '@hyperdx/common-utils/dist/types';

/**
 * Terms to highlight in a result cell, keyed by the column the cell belongs to.
 * Columns with no terms are absent.
 */
export type QueryHighlightTerms = Record<string, string[]>;

/**
 * `ResourceAttributes['service.name']` and `ResourceAttributes.service.name`
 * name the same column; compare them in one form.
 */
function normalizeFieldName(name: string): string {
  return name.replace(/\[\s*['"]([^'"]*)['"]\s*\]/g, '.$1').toLowerCase();
}

/**
 * Spread a Lucene query's terms over the columns they can match. Bare terms
 * search the source's implicit column(s), which we can't resolve here, so they
 * go everywhere; a field-scoped term only highlights in its own column, and
 * nowhere at all when that column isn't displayed.
 */
export function mapHighlightTermsToColumns(
  query: string,
  displayedColumns: string[],
): QueryHighlightTerms {
  const columnsByField = new Map<string, string[]>();
  for (const column of displayedColumns) {
    const key = normalizeFieldName(column);
    columnsByField.set(key, [...(columnsByField.get(key) ?? []), column]);
  }

  const termsByColumn: QueryHighlightTerms = {};
  for (const { term, field } of extractLuceneHighlightTerms(query)) {
    const columns =
      field == null
        ? displayedColumns
        : (columnsByField.get(normalizeFieldName(field)) ?? []);
    for (const column of columns) {
      const terms = (termsByColumn[column] ??= []);
      if (!terms.includes(term)) {
        terms.push(term);
      }
    }
  }

  return termsByColumn;
}

/**
 * Terms from the active Lucene query that explain why the displayed rows
 * matched, ready to highlight per column.
 */
export function useQueryHighlightTerms(
  config:
    | { where?: SearchCondition; whereLanguage?: SearchConditionLanguage }
    | undefined,
  displayedColumns: string[],
): QueryHighlightTerms {
  const query = config?.whereLanguage === 'lucene' ? config.where : undefined;

  return useMemo(
    () => (query ? mapHighlightTermsToColumns(query, displayedColumns) : {}),
    [query, displayedColumns],
  );
}
