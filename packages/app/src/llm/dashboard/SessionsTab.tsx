import { useCallback } from 'react';
import { Grid } from '@mantine/core';

import { INTEGER_NUMBER_FORMAT } from '@/ChartUtils';
import { ChartCard } from '@/components/charts/ChartCard';
import DBTableChart from '@/components/DBTableChart';

import { baseLLMChartConfig } from './chartConfig';
import {
  COST_USD_NUMBER_FORMAT,
  LLMChartProps,
  TOKEN_NUMBER_FORMAT,
} from './types';

const TABLE_HEIGHT = 600;

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

  const getRowLink = useCallback((row: Record<string, unknown>) => {
    const searchParams = new URLSearchParams(window.location.search);
    searchParams.set('llmSession', String(row['Session'] ?? ''));
    return window.location.pathname + '?' + searchParams.toString();
  }, []);

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
                  aggFn: 'count',
                  valueExpression: '',
                  aggCondition: expressions.hasReportedTokens,
                  aggConditionLanguage: 'sql',
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
                  aggFn: 'sum',
                  valueExpression: expressions.totalTokens,
                  aggCondition: expressions.hasReportedTokens,
                  aggConditionLanguage: 'sql',
                  numberFormat: TOKEN_NUMBER_FORMAT,
                },
                {
                  alias: 'Est. Cost',
                  aggFn: 'sum',
                  valueExpression: expressions.costUsd,
                  aggCondition: expressions.hasReportedTokens,
                  aggConditionLanguage: 'sql',
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
