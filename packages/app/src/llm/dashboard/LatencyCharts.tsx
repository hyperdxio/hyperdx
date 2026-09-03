import { DisplayType } from '@hyperdx/common-utils/dist/types';
import { Grid } from '@mantine/core';

import { MS_NUMBER_FORMAT } from '@/ChartUtils';
import { ChartCard } from '@/components/charts/ChartCard';
import { DBTimeChart } from '@/components/DBTimeChart';

import { baseLLMChartConfig } from './chartConfig';
import { LLMChartProps } from './types';

const CHART_HEIGHT = 320;

/**
 * LLM latency trends: p95 per model and time-to-first-token percentiles.
 * The interactive latency heatmap with attribute deltas lives in the
 * dedicated Latency tab (see LatencyTab).
 */
export function LatencyCharts(props: LLMChartProps) {
  const { source, expressions } = props;
  const base = baseLLMChartConfig(props);

  return (
    <>
      <Grid.Col span={6}>
        <ChartCard style={{ height: CHART_HEIGHT }}>
          <DBTimeChart
            title="P95 Latency by Model"
            sourceId={source.id}
            config={{
              ...base,
              displayType: DisplayType.Line,
              select: [
                {
                  aggFn: 'quantile',
                  level: 0.95,
                  valueExpression: `${expressions.duration} / ${expressions.durationDivisorForMillis}`,
                },
              ],
              groupBy: expressions.model,
              numberFormat: MS_NUMBER_FORMAT,
            }}
          />
        </ChartCard>
      </Grid.Col>
      <Grid.Col span={6}>
        <ChartCard style={{ height: CHART_HEIGHT }}>
          <DBTimeChart
            title="Time to First Token"
            sourceId={source.id}
            config={{
              ...base,
              filters: [
                ...base.filters,
                { type: 'sql', condition: expressions.hasTtft },
              ],
              displayType: DisplayType.Line,
              select: [
                {
                  aggFn: 'quantile',
                  level: 0.5,
                  valueExpression: expressions.ttftMs,
                  alias: 'Median',
                },
                {
                  aggFn: 'quantile',
                  level: 0.95,
                  valueExpression: expressions.ttftMs,
                  alias: '95th Percentile',
                },
              ],
              numberFormat: MS_NUMBER_FORMAT,
            }}
          />
        </ChartCard>
      </Grid.Col>
    </>
  );
}
