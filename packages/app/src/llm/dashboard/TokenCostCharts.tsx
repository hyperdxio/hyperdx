import { useCallback } from 'react';
import SqlString from 'sqlstring';
import { DisplayType } from '@hyperdx/common-utils/dist/types';
import { Grid } from '@mantine/core';

import { INTEGER_NUMBER_FORMAT, MS_NUMBER_FORMAT } from '@/ChartUtils';
import { ChartCard } from '@/components/charts/ChartCard';
import DBListBarChart from '@/components/DBListBarChart';
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

/** Token throughput, estimated spend, and the per-model breakdown table. */
export function TokenCostCharts(props: LLMChartProps) {
  const { source, expressions, dateRange } = props;
  const base = baseLLMChartConfig(props);
  const gatedSum = (valueExpression: string) =>
    llmGatedSumExpr(expressions, valueExpression);

  const getModelSearchLink = useCallback(
    (row: Record<string, unknown>) =>
      buildLLMSearchUrl({
        source,
        expressions,
        dateRange,
        extraConditions: [
          SqlString.format('? = ?', [
            SqlString.raw(expressions.model),
            String(row['Model'] ?? ''),
          ]),
        ],
      }),
    [source, expressions, dateRange],
  );

  const getServiceSearchLink = useCallback(
    (row: Record<string, unknown>) =>
      buildLLMSearchUrl({
        source,
        expressions,
        dateRange,
        extraConditions: [
          SqlString.format('? = ?', [
            SqlString.raw(expressions.service),
            String(row['Service'] ?? ''),
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
            title="Token Usage"
            sourceId={source.id}
            config={{
              ...base,
              displayType: DisplayType.StackedBar,
              select: [
                {
                  // Convention-aware uncached share (see effectiveInputTokens)
                  // so the cache-optimization win is visible at a glance.
                  valueExpression: gatedSum(expressions.uncachedInputTokens),
                  alias: 'Uncached Input',
                },
                {
                  valueExpression: gatedSum(expressions.cachedInputTokens),
                  alias: 'Cached Input',
                },
                {
                  valueExpression: gatedSum(expressions.cacheWriteInputTokens),
                  alias: 'Cache Write',
                },
                {
                  valueExpression: gatedSum(
                    `greatest(${expressions.outputTokens} - ${expressions.reasoningTokens}, 0)`,
                  ),
                  alias: 'Output',
                },
                {
                  valueExpression: gatedSum(expressions.reasoningTokens),
                  alias: 'Reasoning',
                },
              ],
              numberFormat: TOKEN_NUMBER_FORMAT,
            }}
          />
        </ChartCard>
      </Grid.Col>
      <Grid.Col span={6}>
        <ChartCard style={{ height: CHART_HEIGHT }}>
          <DBTimeChart
            title="Est. Cost by Model"
            sourceId={source.id}
            config={{
              ...base,
              displayType: DisplayType.StackedBar,
              select: [
                {
                  valueExpression: gatedSum(LLM_COST_SQL_ALIAS),
                  alias: 'Est. Cost',
                },
              ],
              groupBy: expressions.model,
              numberFormat: COST_USD_NUMBER_FORMAT,
            }}
          />
        </ChartCard>
      </Grid.Col>
      <Grid.Col span={7}>
        <ChartCard style={{ height: CHART_HEIGHT }}>
          <DBTableChart
            title="Models"
            getRowSearchLink={getModelSearchLink}
            hiddenColumns={['p95_duration']}
            config={{
              ...base,
              groupBy: 'Model',
              selectGroupBy: false,
              orderBy: '"Calls" DESC',
              select: [
                {
                  alias: 'Model',
                  valueExpression: expressions.model,
                },
                {
                  alias: 'Calls',
                  valueExpression: llmGatedCountExpr(expressions),
                  numberFormat: INTEGER_NUMBER_FORMAT,
                },
                {
                  alias: 'Input Tokens',
                  // Effective input: full context processed incl. cache
                  // reads/writes, comparable across reporting conventions.
                  valueExpression: gatedSum(expressions.effectiveInputTokens),
                  numberFormat: TOKEN_NUMBER_FORMAT,
                },
                {
                  alias: 'Output Tokens',
                  valueExpression: gatedSum(expressions.outputTokens),
                  numberFormat: TOKEN_NUMBER_FORMAT,
                },
                {
                  alias: 'Est. Cost',
                  valueExpression: gatedSum(LLM_COST_SQL_ALIAS),
                  numberFormat: COST_USD_NUMBER_FORMAT,
                },
                {
                  alias: 'Avg Cost / Call',
                  valueExpression: '"Est. Cost" / greatest("Calls", 1)',
                  numberFormat: {
                    factor: 1,
                    output: 'currency',
                    mantissa: 4,
                    thousandSeparated: true,
                    currencySymbol: '$',
                  },
                },
                {
                  alias: 'p95_duration',
                  aggFn: 'quantile',
                  level: 0.95,
                  valueExpression: expressions.duration,
                  aggCondition: '',
                },
                {
                  alias: 'P95 Latency',
                  valueExpression: `p95_duration / ${expressions.durationDivisorForMillis}`,
                  numberFormat: MS_NUMBER_FORMAT,
                },
              ],
              limit: { limit: 100 },
            }}
          />
        </ChartCard>
      </Grid.Col>
      <Grid.Col span={5}>
        <ChartCard style={{ height: CHART_HEIGHT }}>
          <DBListBarChart
            title="Top Services"
            groupColumn="Service"
            valueColumn="Calls"
            getRowSearchLink={getServiceSearchLink}
            config={{
              ...base,
              groupBy: 'Service',
              selectGroupBy: false,
              orderBy: '"Calls" DESC',
              select: [
                {
                  alias: 'Service',
                  valueExpression: expressions.service,
                },
                {
                  alias: 'Calls',
                  valueExpression: llmGatedCountExpr(expressions),
                  numberFormat: INTEGER_NUMBER_FORMAT,
                },
                {
                  alias: 'Total Tokens',
                  valueExpression: gatedSum(expressions.totalTokens),
                  numberFormat: TOKEN_NUMBER_FORMAT,
                },
              ],
              limit: { limit: 20 },
            }}
          />
        </ChartCard>
      </Grid.Col>
    </>
  );
}
