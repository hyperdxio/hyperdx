import { DisplayType, NumberFormat } from '@hyperdx/common-utils/dist/types';
import { Grid } from '@mantine/core';

import {
  ERROR_RATE_PERCENTAGE_NUMBER_FORMAT,
  INTEGER_NUMBER_FORMAT,
} from '@/ChartUtils';
import { ChartCard } from '@/components/charts/ChartCard';
import DBNumberChart from '@/components/DBNumberChart';
import { DBTimeChart } from '@/components/DBTimeChart';
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

const NUMBER_TILE_HEIGHT = 120;
const CHART_HEIGHT = 320;

const PERCENT_NUMBER_FORMAT: NumberFormat = {
  output: 'percent',
  mantissa: 1,
};

const COST_PER_CALL_NUMBER_FORMAT: NumberFormat = {
  factor: 1,
  output: 'currency',
  mantissa: 4,
  thousandSeparated: true,
  currencySymbol: '$',
};

/**
 * Headline KPI tiles + request/error trends, scoped to LLM spans.
 *
 * DBNumberChart displays the first numeric column of the result, so tiles
 * with derived values list the derived expression first — ClickHouse
 * resolves the forward alias references.
 */
export function OverviewCharts(props: LLMChartProps) {
  const { expressions } = props;
  const base = baseLLMChartConfig(props);

  // Election-gated aggregates (raw select expressions): count each call
  // once even when an app runs several instrumentations in parallel.
  const gatedSum = (valueExpression: string, alias: string) => ({
    valueExpression: llmGatedSumExpr(expressions, valueExpression),
    alias,
  });
  const gatedCount = (alias: string) => ({
    valueExpression: llmGatedCountExpr(expressions),
    alias,
  });

  return (
    <>
      <Grid.Col span={2}>
        <ChartCard style={{ height: NUMBER_TILE_HEIGHT }}>
          <DBNumberChart
            title="LLM Calls"
            config={{
              ...base,
              select: [gatedCount('llm_calls')],
              numberFormat: INTEGER_NUMBER_FORMAT,
            }}
          />
        </ChartCard>
      </Grid.Col>
      <Grid.Col span={2}>
        <ChartCard style={{ height: NUMBER_TILE_HEIGHT }}>
          <DBNumberChart
            title="Total Tokens"
            config={{
              ...base,
              select: [gatedSum(expressions.totalTokens, 'total_tokens')],
              numberFormat: TOKEN_NUMBER_FORMAT,
            }}
          />
        </ChartCard>
      </Grid.Col>
      <Grid.Col span={2}>
        <ChartCard style={{ height: NUMBER_TILE_HEIGHT }}>
          <DBNumberChart
            title="Est. Cost"
            config={{
              ...base,
              select: [gatedSum(LLM_COST_SQL_ALIAS, 'total_cost')],
              numberFormat: COST_USD_NUMBER_FORMAT,
            }}
          />
        </ChartCard>
      </Grid.Col>
      <Grid.Col span={2}>
        <ChartCard style={{ height: NUMBER_TILE_HEIGHT }}>
          <DBNumberChart
            title="Avg Cost / Call"
            config={{
              ...base,
              select: [
                {
                  valueExpression: 'total_cost / greatest(llm_calls, 1)',
                  alias: 'avg_cost_per_call',
                },
                gatedSum(LLM_COST_SQL_ALIAS, 'total_cost'),
                gatedCount('llm_calls'),
              ],
              numberFormat: COST_PER_CALL_NUMBER_FORMAT,
            }}
          />
        </ChartCard>
      </Grid.Col>
      <Grid.Col span={2}>
        <ChartCard style={{ height: NUMBER_TILE_HEIGHT }}>
          <DBNumberChart
            title="Cache Hit Rate"
            config={{
              ...base,
              select: [
                {
                  valueExpression: 'cached_tokens / greatest(input_tokens, 1)',
                  alias: 'cache_hit_rate',
                },
                gatedSum(expressions.cachedInputTokens, 'cached_tokens'),
                gatedSum(expressions.effectiveInputTokens, 'input_tokens'),
              ],
              numberFormat: PERCENT_NUMBER_FORMAT,
            }}
          />
        </ChartCard>
      </Grid.Col>
      <Grid.Col span={2}>
        <ChartCard style={{ height: NUMBER_TILE_HEIGHT }}>
          <DBNumberChart
            title="Error Rate"
            config={{
              ...base,
              select: [
                {
                  valueExpression: 'error_count / greatest(total_count, 1)',
                  alias: 'error_rate',
                },
                {
                  aggFn: 'count',
                  valueExpression: '',
                  aggCondition: expressions.isError,
                  aggConditionLanguage: 'sql',
                  alias: 'error_count',
                },
                { aggFn: 'count', valueExpression: '', alias: 'total_count' },
              ],
              numberFormat: ERROR_RATE_PERCENTAGE_NUMBER_FORMAT,
            }}
          />
        </ChartCard>
      </Grid.Col>
      <Grid.Col span={6}>
        <ChartCard style={{ height: CHART_HEIGHT }}>
          <DBTimeChart
            title="LLM Calls by Model"
            sourceId={props.source.id}
            config={{
              ...base,
              displayType: DisplayType.StackedBar,
              select: [gatedCount('Calls')],
              groupBy: expressions.model,
              numberFormat: INTEGER_NUMBER_FORMAT,
            }}
          />
        </ChartCard>
      </Grid.Col>
      <Grid.Col span={6}>
        <ChartCard style={{ height: CHART_HEIGHT }}>
          <DBTimeChart
            title="Error Rate"
            sourceId={props.source.id}
            config={{
              ...base,
              displayType: DisplayType.Line,
              select: [
                {
                  aggFn: 'count',
                  valueExpression: '',
                  aggCondition: expressions.isError,
                  aggConditionLanguage: 'sql',
                  alias: 'error_count',
                },
                { aggFn: 'count', valueExpression: '', alias: 'total_count' },
                {
                  valueExpression: 'error_count / total_count',
                  alias: 'Error Rate',
                },
              ],
              numberFormat: ERROR_RATE_PERCENTAGE_NUMBER_FORMAT,
            }}
            hiddenSeries={['error_count', 'total_count']}
          />
        </ChartCard>
      </Grid.Col>
    </>
  );
}
