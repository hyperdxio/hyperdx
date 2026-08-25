import SqlString from 'sqlstring';
import {
  Filter,
  pickSampleWeightExpressionProps,
} from '@hyperdx/common-utils/dist/types';

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
}: LLMChartProps & { extraFilters?: Filter[] }) {
  return {
    source: source.id,
    timestampValueExpression: source.timestampValueExpression,
    connection: source.connection,
    from: source.from,
    implicitColumnExpression: source.implicitColumnExpression,
    useTextIndexForImplicitColumn: source.useTextIndexForImplicitColumn,
    ...pickSampleWeightExpressionProps(source),
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
