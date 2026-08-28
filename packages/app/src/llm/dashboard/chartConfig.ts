import SqlString from 'sqlstring';
import {
  Filter,
  pickSampleWeightExpressionProps,
} from '@hyperdx/common-utils/dist/types';

import { IS_LLM_COST_ENABLED } from '@/config';
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
  withCostAlias = IS_LLM_COST_ENABLED,
}: LLMChartProps & {
  extraFilters?: Filter[];
  /**
   * Bind the cost expression as a WITH alias (see LLM_COST_SQL_ALIAS). On by
   * default while cost display is enabled; charts that never reference cost
   * (e.g. error row tables) can opt out to keep their queries small. When
   * cost display is off nothing selects the alias, so the ~70 KiB binding
   * is skipped everywhere.
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
 * Attribute values longer than this are dropped from delta sampling rows
 * server-side. Categorical values worth breaking down on (model ids,
 * providers, finish reasons, tool names) are far shorter; anything longer
 * would be hidden client-side as high-cardinality anyway.
 */
export const DELTA_ATTRIBUTE_VALUE_MAX_LENGTH = 256;

const BARE_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * Select list for the Latency tab's delta sampling queries. Agent SDKs stamp
 * full conversation histories on every span, so a raw 1000-row `SELECT *`
 * sample of LLM spans measured ~400 MiB — trimming long attribute values
 * server-side cuts that ~500x. Falls back to '*' when the attribute column
 * isn't a plain Map column (mapFilter doesn't apply to JSON-typed columns or
 * derived expressions).
 */
export function buildTrimmedDeltaSelect(
  source: LLMChartProps['source'],
  jsonColumns: string[] | undefined,
): string {
  const attrCol = source.eventAttributesExpression || 'SpanAttributes';
  if (!BARE_IDENTIFIER.test(attrCol) || jsonColumns?.includes(attrCol)) {
    return '*';
  }
  return (
    `* EXCEPT (${attrCol}), ` +
    `mapFilter((k, v) -> length(v) <= ${DELTA_ATTRIBUTE_VALUE_MAX_LENGTH}, ${attrCol}) AS ${attrCol}`
  );
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
