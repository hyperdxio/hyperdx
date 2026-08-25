import { DisplayType, NumberFormat } from '@hyperdx/common-utils/dist/types';
import { Grid } from '@mantine/core';

import { INTEGER_NUMBER_FORMAT } from '@/ChartUtils';
import { ChartCard } from '@/components/charts/ChartCard';
import { DBTimeChart } from '@/components/DBTimeChart';

import { baseLLMChartConfig } from './chartConfig';
import { LLMChartProps } from './types';

const CHART_HEIGHT = 320;

const PERCENT_NUMBER_FORMAT: NumberFormat = {
  output: 'percent',
  mantissa: 1,
};

/**
 * Cost-efficiency and response-quality signals: prompt cache utilization
 * over time and finish-reason mix (surfaces `max_tokens` truncation and
 * content filtering trends).
 */
export function EfficiencyCharts(props: LLMChartProps) {
  const { source, expressions } = props;
  const base = baseLLMChartConfig(props);

  return (
    <>
      <Grid.Col span={6}>
        <ChartCard style={{ height: CHART_HEIGHT }}>
          <DBTimeChart
            title="Cache Hit Rate"
            sourceId={source.id}
            hiddenSeries={['cached_tokens', 'input_tokens']}
            config={{
              ...base,
              displayType: DisplayType.Line,
              select: [
                {
                  aggFn: 'sum',
                  valueExpression: expressions.cachedInputTokens,
                  alias: 'cached_tokens',
                  aggCondition: expressions.hasReportedTokens,
                  aggConditionLanguage: 'sql',
                },
                {
                  aggFn: 'sum',
                  valueExpression: expressions.effectiveInputTokens,
                  alias: 'input_tokens',
                  aggCondition: expressions.hasReportedTokens,
                  aggConditionLanguage: 'sql',
                },
                {
                  valueExpression: 'cached_tokens / greatest(input_tokens, 1)',
                  alias: 'Cache Hit Rate',
                },
              ],
              numberFormat: PERCENT_NUMBER_FORMAT,
            }}
          />
        </ChartCard>
      </Grid.Col>
      <Grid.Col span={6}>
        <ChartCard style={{ height: CHART_HEIGHT }}>
          <DBTimeChart
            title="Finish Reasons"
            sourceId={source.id}
            config={{
              ...base,
              displayType: DisplayType.StackedBar,
              select: [{ aggFn: 'count', valueExpression: '' }],
              groupBy: expressions.finishReason,
              filters: [
                ...base.filters,
                { type: 'sql', condition: expressions.hasFinishReason },
              ],
              numberFormat: INTEGER_NUMBER_FORMAT,
            }}
          />
        </ChartCard>
      </Grid.Col>
    </>
  );
}
