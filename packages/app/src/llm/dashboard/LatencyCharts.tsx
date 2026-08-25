import { DisplayType } from '@hyperdx/common-utils/dist/types';
import { Grid } from '@mantine/core';

import { MS_NUMBER_FORMAT } from '@/ChartUtils';
import { ChartCard } from '@/components/charts/ChartCard';
import DBHeatmapChart from '@/components/DBHeatmapChart';
import { DBTimeChart } from '@/components/DBTimeChart';

import { baseLLMChartConfig } from './chartConfig';
import { LLMChartProps } from './types';

const HEATMAP_HEIGHT = 250;
const CHART_HEIGHT = 320;

/**
 * LLM call latency: a duration heatmap (ClickHouse-dashboard style) plus p95
 * per model over time.
 */
export function LatencyCharts(props: LLMChartProps) {
  const { source, expressions } = props;
  const base = baseLLMChartConfig(props);

  return (
    <>
      <Grid.Col span={12}>
        <ChartCard style={{ height: HEATMAP_HEIGHT }}>
          <DBHeatmapChart
            title="LLM Call Latency"
            config={{
              ...base,
              displayType: DisplayType.Heatmap,
              select: [
                {
                  aggFn: 'heatmap',
                  valueExpression: expressions.durationInMillis,
                },
              ],
              granularity: 'auto',
            }}
          />
        </ChartCard>
      </Grid.Col>
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
