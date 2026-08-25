import SqlString from 'sqlstring';
import {
  Filter,
  pickSampleWeightExpressionProps,
} from '@hyperdx/common-utils/dist/types';

import { LLM_COST_SQL_ALIAS } from '@/llm/lib/expressions';

import { LLMChartProps } from './types';

/** `sessionIdExpr = 'value'` condition, SQL-escaped. */
export function buildSessionCondition(
  sessionIdExpr: string,
  sessionId: string,
): string {
  return SqlString.format('? = ?', [SqlString.raw(sessionIdExpr), sessionId]);
}

/**
 * Base chart-config fields shared by every LLM dashboard chart: source
 * binding, the user's where clause, the LLM-span scope filter, the optional
 * session-id scope, and the searched date range.
 */
export function baseLLMChartConfig({
  source,
  expressions,
  dateRange,
  where,
  whereLanguage,
  sessionId,
  extraFilters = [],
  withCostAlias = true,
}: LLMChartProps & {
  extraFilters?: Filter[];
  /**
   * Bind the cost expression as a WITH alias (see LLM_COST_SQL_ALIAS). On by
   * default; charts that never reference cost (e.g. search row tables) can
   * opt out to keep their queries small.
   */
  withCostAlias?: boolean;
}) {
  return {
    source: source.id,
    timestampValueExpression: source.timestampValueExpression,
    connection: source.connection,
    from: source.from,
    implicitColumnExpression: source.implicitColumnExpression,
    useTextIndexForImplicitColumn: source.useTextIndexForImplicitColumn,
    ...pickSampleWeightExpressionProps(source),
    // Bind the (catalog-sized) cost expression once per query; charts
    // reference it as LLM_COST_SQL_ALIAS. Referencing the full expression
    // repeatedly would exceed ClickHouse's default 256 KiB max_query_size.
    ...(withCostAlias
      ? {
          with: [
            {
              name: LLM_COST_SQL_ALIAS,
              sql: { sql: expressions.costUsd, params: {} },
              isSubquery: false,
            },
          ],
        }
      : {}),
    where,
    whereLanguage,
    filters: [
      { type: 'sql' as const, condition: expressions.isLLMSpan },
      ...(sessionId
        ? [
            {
              type: 'sql' as const,
              condition: buildSessionCondition(
                expressions.sessionId,
                sessionId,
              ),
            },
          ]
        : []),
      ...extraFilters,
    ],
    dateRange,
  };
}

/**
 * Build a where-clause fragment for a delta-chart filter click. `property`
 * arrives in ClickHouse bracket notation (e.g.
 * `SpanAttributes['gen_ai.request.model']`) from DBDeltaChart. For lucene,
 * bracket notation is converted to the dot form the lucene parser expects.
 * The 'only' action is equivalent to 'include' here — with a single where
 * input there is no value set to narrow.
 */
export function buildDeltaFilterClause(
  property: string,
  value: string,
  action: 'only' | 'include' | 'exclude' | undefined,
  language: 'sql' | 'lucene',
): string {
  const exclude = action === 'exclude';
  if (language === 'sql') {
    return SqlString.format(exclude ? '? != ?' : '? = ?', [
      SqlString.raw(property),
      value,
    ]);
  }
  const luceneKey = property.replace(
    /^([A-Za-z0-9_]+)\['(.+)'\]$/,
    (_m, col, key) => `${col}.${key}`,
  );
  const luceneValue = `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
  return `${exclude ? '-' : ''}${luceneKey}:${luceneValue}`;
}

/** Append a clause to an existing where string in the given language. */
export function appendWhereClause(
  existing: string,
  clause: string,
  language: 'sql' | 'lucene',
): string {
  const trimmed = existing.trim();
  if (!trimmed) return clause;
  return language === 'sql'
    ? `(${trimmed}) AND ${clause}`
    : `${trimmed} ${clause}`;
}

/** Build a /search URL scoped to LLM spans plus optional extra conditions. */
export function buildLLMSearchUrl({
  source,
  expressions,
  dateRange,
  extraConditions = [],
}: Pick<LLMChartProps, 'source' | 'expressions' | 'dateRange'> & {
  extraConditions?: string[];
}): string {
  const filters: Filter[] = [
    { type: 'sql', condition: expressions.isLLMSpan },
    ...extraConditions.map(condition => ({ type: 'sql' as const, condition })),
  ];
  const params = new URLSearchParams({
    source: source.id,
    where: '',
    whereLanguage: 'sql',
    filters: JSON.stringify(filters),
    isLive: 'false',
    from: dateRange[0].getTime().toString(),
    to: dateRange[1].getTime().toString(),
  });
  return `/search?${params.toString()}`;
}
