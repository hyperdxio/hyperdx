import { useMemo } from 'react';
import { extractLuceneHighlightTerms } from '@hyperdx/common-utils/dist/queryParser';
import {
  Filter,
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
 * Spread Lucene terms over the columns they can match. Bare terms search the
 * source's implicit column(s), which we can't resolve here, so they go
 * everywhere; a field-scoped term only highlights in its own column, and
 * nowhere at all when that column isn't displayed.
 */
export function mapHighlightTermsToColumns(
  conditions: string[],
  displayedColumns: string[],
): QueryHighlightTerms {
  const columnsByField = new Map<string, string[]>();
  for (const column of displayedColumns) {
    const key = normalizeFieldName(column);
    columnsByField.set(key, [...(columnsByField.get(key) ?? []), column]);
  }

  const termsByColumn: QueryHighlightTerms = {};
  const addTerm = (column: string, term: string) => {
    const terms = (termsByColumn[column] ??= []);
    if (!terms.includes(term)) {
      terms.push(term);
    }
  };

  for (const condition of conditions) {
    for (const { term, field } of extractLuceneHighlightTerms(condition)) {
      const columns =
        field == null
          ? displayedColumns
          : (columnsByField.get(normalizeFieldName(field)) ?? []);
      for (const column of columns) {
        addTerm(column, term);
      }
    }
  }

  return termsByColumn;
}

/**
 * Terms from the active Lucene query (and any Lucene sidebar filters) that
 * explain why the displayed rows matched, ready to highlight per column.
 */
export function useQueryHighlightTerms({
  where,
  whereLanguage,
  filters,
  displayedColumns,
}: {
  where?: SearchCondition;
  whereLanguage?: SearchConditionLanguage;
  filters?: Filter[];
  displayedColumns: string[];
}): QueryHighlightTerms {
  const conditions = useMemo(() => {
    const luceneConditions: string[] = [];
    if (whereLanguage === 'lucene' && where) {
      luceneConditions.push(where);
    }
    for (const filter of filters ?? []) {
      if (filter.type === 'lucene') {
        luceneConditions.push(filter.condition);
      }
    }
    return luceneConditions;
  }, [where, whereLanguage, filters]);

  return useMemo(
    () => mapHighlightTermsToColumns(conditions, displayedColumns),
    [conditions, displayedColumns],
  );
}
