import type { Filter } from '@hyperdx/common-utils/dist/types';

export type ChartExplorerQuery = {
  where: string;
  whereLanguage: 'sql' | 'lucene';
  /**
   * Only set when the filters could not be folded into `where`. They still
   * apply to the rendered query, but the Chart Explorer form has no UI for
   * them, so this is the less desirable of the two representations.
   */
  filters?: Filter[];
};

/** Renders a filter as a standalone SQL condition, or null if it has no SQL form. */
function filterToSqlCondition(filter: Filter): string | null {
  if (filter.type === 'sql_ast') {
    return `${filter.left} ${filter.operator} ${filter.right}`;
  }
  if (filter.type === 'sql') {
    return filter.condition.trim() || null;
  }
  return null;
}

/**
 * Combines the Search page's WHERE clause and sidebar filters into the single
 * WHERE clause that Chart Explorer exposes.
 *
 * Chart Explorer's form has no filter UI, so filters carried over as
 * `config.filters` would silently narrow the chart with no way to see or remove
 * them. Folding them into WHERE keeps the whole query visible and editable.
 * Filters with no SQL rendering (Lucene), or a Lucene WHERE that cannot be
 * concatenated with SQL filters, fall back to `config.filters` so the chart
 * still matches what the user was looking at.
 */
export function buildChartExplorerQuery({
  where,
  whereLanguage,
  filters,
}: {
  where?: string | null;
  whereLanguage?: 'sql' | 'lucene' | null;
  filters?: Filter[] | null;
}): ChartExplorerQuery {
  const trimmedWhere = (where ?? '').trim();
  const language = whereLanguage ?? 'lucene';
  const activeFilters = filters ?? [];

  if (activeFilters.length === 0) {
    return { where: trimmedWhere, whereLanguage: language };
  }

  const sqlConditions: string[] = [];
  for (const filter of activeFilters) {
    const condition = filterToSqlCondition(filter);
    if (condition == null) {
      return {
        where: trimmedWhere,
        whereLanguage: language,
        filters: activeFilters,
      };
    }
    sqlConditions.push(condition);
  }

  if (trimmedWhere === '') {
    return { where: joinConditions(sqlConditions), whereLanguage: 'sql' };
  }

  if (language === 'sql') {
    return {
      where: joinConditions([trimmedWhere, ...sqlConditions]),
      whereLanguage: 'sql',
    };
  }

  // A Lucene WHERE has no SQL equivalent we can produce here, so it stays as-is
  // and the filters ride along on the config instead.
  return {
    where: trimmedWhere,
    whereLanguage: 'lucene',
    filters: activeFilters,
  };
}

/**
 * Parenthesizes each condition before joining so that operators inside a
 * condition (`OR`, or the `AND` in `BETWEEN x AND y`) keep their precedence.
 */
function joinConditions(conditions: string[]): string {
  if (conditions.length === 1) {
    return conditions[0];
  }
  return conditions.map(condition => `(${condition})`).join(' AND ');
}
