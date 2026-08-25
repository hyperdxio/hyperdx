import {
  type FilterState,
  filtersToQuery,
} from '@hyperdx/common-utils/dist/filters';
import { SourceKind } from '@hyperdx/common-utils/dist/types';

import { formatDurationBound } from './durationBound';

const EXPLORE_LANGUAGE_KEY_PREFIX = 'hdx-explore-where-language:';

export type QueryLanguage = 'sql' | 'lucene';

export type QueryEditorMode = 'lucene' | 'raw';

export function getDefaultExploreLanguage(_kind?: SourceKind): QueryLanguage {
  return 'lucene';
}

export function getExploreWhereLanguage(kind?: SourceKind): QueryLanguage {
  if (typeof window !== 'undefined' && kind != null) {
    try {
      const stored = window.localStorage.getItem(
        `${EXPLORE_LANGUAGE_KEY_PREFIX}${kind}`,
      );
      if (stored === 'sql' || stored === 'lucene') {
        return stored;
      }
    } catch {
      // localStorage may throw in private browsing
    }
  }
  return getDefaultExploreLanguage(kind);
}

export function setExploreWhereLanguage(
  kind: SourceKind | undefined,
  language: QueryLanguage,
): void {
  if (typeof window === 'undefined' || kind == null) {
    return;
  }
  try {
    window.localStorage.setItem(
      `${EXPLORE_LANGUAGE_KEY_PREFIX}${kind}`,
      language,
    );
  } catch {
    // localStorage may throw in private browsing
  }
}

function luceneQuote(value: string): string {
  if (/^[\w.*-]+$/.test(value)) {
    return value;
  }
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function luceneBound(field: string, n: number): string {
  return /duration/i.test(field) ? formatDurationBound(n) : String(n);
}

function luceneRangeClause(
  field: string,
  range: NonNullable<FilterState[string]['range']>,
): string | null {
  const { min, max, minOp = '>=', maxOp = '<=' } = range;
  if (min != null && max != null) {
    return `${field}:[${min} TO ${max}]`;
  }
  if (min != null) {
    return `${field}:${minOp}${luceneBound(field, min)}`;
  }
  if (max != null) {
    return `${field}:${maxOp}${luceneBound(field, max)}`;
  }
  return null;
}

export function filterStateToLucene(filters: FilterState): string {
  const parts: string[] = [];
  for (const [field, state] of Object.entries(filters)) {
    for (const value of state.included) {
      parts.push(`${field}:${luceneQuote(String(value))}`);
    }
    for (const value of state.excluded) {
      parts.push(`-${field}:${luceneQuote(String(value))}`);
    }
    if (state.range != null) {
      const luceneRange = luceneRangeClause(field, state.range);
      if (luceneRange != null) {
        parts.push(luceneRange);
      }
    }
  }
  return parts.join(' AND ');
}

export function filterStateToSql(filters: FilterState): string {
  return filtersToQuery(filters)
    .map(filter => ('condition' in filter ? filter.condition : ''))
    .filter(Boolean)
    .join(' AND ');
}

type FilterExampleTone = 'danger' | 'warning';

export type FilterExampleQuery = {
  label: string;
  lucene: string;
  sql: string;
  tone: FilterExampleTone;
};

export function getFilterExampleQueries(
  kind?: SourceKind,
): FilterExampleQuery[] {
  if (kind === SourceKind.Trace) {
    return [
      {
        label: 'Error',
        lucene: 'status:error',
        sql: "status = 'error'",
        tone: 'danger',
      },
      {
        label: 'Warning',
        lucene: 'status:warn',
        sql: "status = 'warn'",
        tone: 'warning',
      },
      {
        label: 'Slow spans',
        lucene: 'duration:>1s',
        sql: 'Duration > 1000000000',
        tone: 'warning',
      },
    ];
  }
  if (kind === SourceKind.Metric || kind === SourceKind.Promql) {
    return [];
  }
  return [
    {
      label: 'Error',
      lucene: 'level:error',
      sql: "level = 'error'",
      tone: 'danger',
    },
    {
      label: 'Warning',
      lucene: 'level:warn',
      sql: "level = 'warn'",
      tone: 'warning',
    },
    {
      label: 'HTTP 5xx',
      lucene: 'status:>=500',
      sql: 'status >= 500',
      tone: 'danger',
    },
  ];
}
