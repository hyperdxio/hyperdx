import { useCallback } from 'react';
import { useSearchParams } from 'next/navigation';
import { Grid } from '@mantine/core';

import { INTEGER_NUMBER_FORMAT } from '@/ChartUtils';
import { ChartCard } from '@/components/charts/ChartCard';
import DBTableChart from '@/components/DBTableChart';
import {
  LLM_COST_SQL_ALIAS,
  llmGatedCountExpr,
  llmGatedSumExpr,
} from '@/llm/lib/expressions';

import { baseLLMChartConfig } from './chartConfig';
import {
  COST_USD_NUMBER_FORMAT,
  LLMChartProps,
  TOKEN_NUMBER_FORMAT,
} from './types';

const TABLE_HEIGHT = 600;

/**
 * Build a session-row href that preserves the given query params (tab, time
 * range, filters, ...) and opens the session drawer. Exported for tests.
 */
export function buildSessionRowHref(
  pathname: string,
  search: string,
  sessionValue: string,
): string {
  const params = new URLSearchParams(search);
  params.set('llmSession', sessionValue);
  return pathname + '?' + params.toString();
}

/**
 * Sessions list: LLM activity grouped by session/conversation id
 * (gen_ai.conversation.id, session.id, or ai.telemetry.metadata.sessionId).
 * This is the primary correlation surface for instrumentations that don't
 * propagate trace context but stamp a session id on every span and log.
 * Clicking a row opens the session detail panel via the `llmSession` query
 * param.
 */
export function SessionsTab(props: LLMChartProps) {
  const { expressions } = props;
  const base = baseLLMChartConfig({
    ...props,
    extraFilters: [{ type: 'sql', condition: expressions.hasSessionId }],
  });

  // Reactive search params (not a window.location snapshot): the row hrefs
  // are computed at render time and cached rows can render before an async
  // nuqs URL write (e.g. a tab switch) lands — a snapshot would then bake
  // the previous tab into the link and clicking a session would navigate
  // back to it.
  const searchParams = useSearchParams();
  const getRowLink = useCallback(
    (row: Record<string, unknown>) =>
      buildSessionRowHref(
        window.location.pathname,
        searchParams?.toString() ?? '',
        String(row['Session'] ?? ''),
      ),
    [searchParams],
  );

  return (
    <Grid grow={false} w="100%" maw="100%">
      <Grid.Col span={12}>
        <ChartCard style={{ height: TABLE_HEIGHT }}>
          <DBTableChart
            title="LLM Sessions"
            getRowSearchLink={getRowLink}
            hiddenColumns={['start_ts', 'end_ts']}
            config={{
              ...base,
              groupBy: 'Session',
              selectGroupBy: false,
              orderBy: '"end_ts" DESC',
              select: [
                {
                  alias: 'Session',
                  valueExpression: expressions.sessionId,
                },
                // Raw min/max (not aggFn entries): the chart builder coerces
                // aggFn inputs through toFloat64OrDefault(toString(...)),
                // which turns DateTime64 into Float64 and breaks
                // toString/dateDiff on the aliases below.
                {
                  alias: 'start_ts',
                  valueExpression: `min(${props.source.timestampValueExpression})`,
                },
                {
                  alias: 'end_ts',
                  valueExpression: `max(${props.source.timestampValueExpression})`,
                },
                {
                  alias: 'Start',
                  valueExpression: 'toString(start_ts)',
                },
                {
                  alias: 'Duration (s)',
                  valueExpression: "dateDiff('second', start_ts, end_ts)",
                  numberFormat: INTEGER_NUMBER_FORMAT,
                },
                {
                  alias: 'LLM Calls',
                  valueExpression: llmGatedCountExpr(expressions),
                  numberFormat: INTEGER_NUMBER_FORMAT,
                },
                {
                  alias: 'Tool Calls',
                  aggFn: 'count',
                  valueExpression: '',
                  aggCondition: expressions.isToolSpan,
                  aggConditionLanguage: 'sql',
                  numberFormat: INTEGER_NUMBER_FORMAT,
                },
                {
                  alias: 'Models',
                  valueExpression: `arrayStringConcat(groupUniqArrayIf(3)(${expressions.model}, ${expressions.model} != ''), ', ')`,
                },
                {
                  alias: 'Total Tokens',
                  valueExpression: llmGatedSumExpr(
                    expressions,
                    expressions.totalTokens,
                  ),
                  numberFormat: TOKEN_NUMBER_FORMAT,
                },
                {
                  alias: 'Est. Cost',
                  valueExpression: llmGatedSumExpr(
                    expressions,
                    LLM_COST_SQL_ALIAS,
                  ),
                  numberFormat: COST_USD_NUMBER_FORMAT,
                },
                {
                  alias: 'Errors',
                  aggFn: 'count',
                  valueExpression: '',
                  aggCondition: expressions.isError,
                  aggConditionLanguage: 'sql',
                  numberFormat: INTEGER_NUMBER_FORMAT,
                },
              ],
              limit: { limit: 200 },
            }}
          />
        </ChartCard>
      </Grid.Col>
    </Grid>
  );
}
