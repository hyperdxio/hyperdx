import { useCallback } from 'react';
import SqlString from 'sqlstring';
import { DisplayType } from '@hyperdx/common-utils/dist/types';
import { Grid } from '@mantine/core';

import {
  ERROR_RATE_PERCENTAGE_NUMBER_FORMAT,
  INTEGER_NUMBER_FORMAT,
  MS_NUMBER_FORMAT,
} from '@/ChartUtils';
import { ChartCard } from '@/components/charts/ChartCard';
import DBTableChart from '@/components/DBTableChart';
import { DBTimeChart } from '@/components/DBTimeChart';
import {
  LLM_COST_SQL_ALIAS,
  llmGatedCountExpr,
  llmGatedSumExpr,
} from '@/llm/lib/expressions';

import { baseLLMChartConfig, buildLLMSearchUrl } from './chartConfig';
import {
  COST_USD_NUMBER_FORMAT,
  LLMChartProps,
  TOKEN_NUMBER_FORMAT,
} from './types';

const CHART_HEIGHT = 320;

/**
 * Agent/tool monitoring (Datadog Agent Monitoring parity): tool-call volume
 * per tool, a per-tool table with error rate and p95 duration, and usage
 * broken down by agent (gen_ai.agent.name) for agent frameworks.
 */
export function AgentToolCharts(props: LLMChartProps) {
  const { source, expressions, dateRange } = props;
  const base = baseLLMChartConfig(props);
  const toolFilters = [
    ...base.filters,
    { type: 'sql' as const, condition: expressions.isToolSpan },
  ];
  const agentFilters = [
    ...base.filters,
    { type: 'sql' as const, condition: expressions.hasAgentName },
  ];

  const getToolSearchLink = useCallback(
    (row: Record<string, unknown>) =>
      buildLLMSearchUrl({
        source,
        expressions,
        dateRange,
        extraConditions: [
          expressions.isToolSpan,
          SqlString.format('? = ?', [
            SqlString.raw(expressions.toolName),
            String(row['Tool'] ?? ''),
          ]),
        ],
      }),
    [source, expressions, dateRange],
  );

  const getAgentSearchLink = useCallback(
    (row: Record<string, unknown>) =>
      buildLLMSearchUrl({
        source,
        expressions,
        dateRange,
        extraConditions: [
          SqlString.format('? = ?', [
            SqlString.raw(expressions.agentName),
            String(row['Agent'] ?? ''),
          ]),
        ],
      }),
    [source, expressions, dateRange],
  );

  return (
    <>
      <Grid.Col span={6}>
        <ChartCard style={{ height: CHART_HEIGHT }}>
          <DBTimeChart
            title="Tool Calls by Tool"
            sourceId={source.id}
            config={{
              ...base,
              filters: toolFilters,
              displayType: DisplayType.StackedBar,
              select: [{ aggFn: 'count', valueExpression: '' }],
              groupBy: expressions.toolName,
              numberFormat: INTEGER_NUMBER_FORMAT,
            }}
          />
        </ChartCard>
      </Grid.Col>
      <Grid.Col span={6}>
        <ChartCard style={{ height: CHART_HEIGHT }}>
          <DBTableChart
            title="Top Tools"
            getRowSearchLink={getToolSearchLink}
            hiddenColumns={['error_count', 'p95_duration']}
            config={{
              ...base,
              filters: toolFilters,
              groupBy: 'Tool',
              selectGroupBy: false,
              orderBy: '"Calls" DESC',
              select: [
                {
                  alias: 'Tool',
                  valueExpression: `coalesce(nullif(${expressions.toolName}, ''), '(unnamed)')`,
                },
                {
                  alias: 'Calls',
                  aggFn: 'count',
                  valueExpression: '',
                  numberFormat: INTEGER_NUMBER_FORMAT,
                },
                {
                  alias: 'error_count',
                  aggFn: 'count',
                  valueExpression: '',
                  aggCondition: expressions.isError,
                  aggConditionLanguage: 'sql',
                },
                {
                  alias: 'Error Rate',
                  valueExpression: 'error_count / greatest("Calls", 1)',
                  numberFormat: ERROR_RATE_PERCENTAGE_NUMBER_FORMAT,
                },
                {
                  alias: 'p95_duration',
                  aggFn: 'quantile',
                  level: 0.95,
                  valueExpression: expressions.duration,
                  aggCondition: '',
                },
                {
                  alias: 'P95 Duration',
                  valueExpression: `p95_duration / ${expressions.durationDivisorForMillis}`,
                  numberFormat: MS_NUMBER_FORMAT,
                },
              ],
              limit: { limit: 50 },
            }}
          />
        </ChartCard>
      </Grid.Col>
      <Grid.Col span={6}>
        <ChartCard style={{ height: CHART_HEIGHT }}>
          <DBTimeChart
            title="LLM Calls by Agent"
            sourceId={source.id}
            config={{
              ...base,
              filters: agentFilters,
              displayType: DisplayType.StackedBar,
              select: [
                {
                  valueExpression: llmGatedCountExpr(expressions),
                  alias: 'Calls',
                },
              ],
              groupBy: expressions.agentName,
              numberFormat: INTEGER_NUMBER_FORMAT,
            }}
          />
        </ChartCard>
      </Grid.Col>
      <Grid.Col span={6}>
        <ChartCard style={{ height: CHART_HEIGHT }}>
          <DBTableChart
            title="Agents"
            getRowSearchLink={getAgentSearchLink}
            hiddenColumns={['error_count', 'span_count']}
            config={{
              ...base,
              filters: agentFilters,
              groupBy: 'Agent',
              selectGroupBy: false,
              orderBy: '"Est. Cost" DESC',
              select: [
                {
                  alias: 'Agent',
                  valueExpression: expressions.agentName,
                },
                {
                  alias: 'Calls',
                  valueExpression: llmGatedCountExpr(expressions),
                  numberFormat: INTEGER_NUMBER_FORMAT,
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
                  alias: 'span_count',
                  aggFn: 'count',
                  valueExpression: '',
                },
                {
                  alias: 'error_count',
                  aggFn: 'count',
                  valueExpression: '',
                  aggCondition: expressions.isError,
                  aggConditionLanguage: 'sql',
                },
                {
                  alias: 'Error Rate',
                  valueExpression: 'error_count / greatest(span_count, 1)',
                  numberFormat: ERROR_RATE_PERCENTAGE_NUMBER_FORMAT,
                },
              ],
              limit: { limit: 50 },
            }}
          />
        </ChartCard>
      </Grid.Col>
    </>
  );
}
