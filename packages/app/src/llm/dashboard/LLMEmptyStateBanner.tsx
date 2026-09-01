import { Alert } from '@mantine/core';

import { useQueriedChartConfig } from '@/hooks/useChartConfig';

import { baseLLMChartConfig } from './chartConfig';
import { LLMChartProps } from './types';

/**
 * Shown when the selected trace source has no LLM spans in the searched
 * window, pointing users at the supported instrumentation options instead of
 * a page of empty charts.
 */
export function LLMEmptyStateBanner(props: LLMChartProps) {
  const config = {
    // Plain span count; skip the cost-alias WITH binding to keep it small.
    ...baseLLMChartConfig({ ...props, withCostAlias: false }),
    select: [{ aggFn: 'count' as const, valueExpression: '', alias: 'count' }],
  };

  const { data, isLoading, isError } = useQueriedChartConfig(config, {
    queryKey: ['llm-dashboard-llm-span-count', config],
    enabled: true,
  });

  const count = Number(data?.data?.[0]?.count ?? 0);
  if (isLoading || isError || count > 0) {
    return null;
  }

  return (
    <Alert variant="info" title="No LLM spans found" mb="sm">
      No spans with LLM instrumentation were found in the selected time range.
      This dashboard works with traces emitted by OpenTelemetry GenAI semantic
      conventions, OpenLLMetry, OpenInference, or the Vercel AI SDK — point that
      instrumentation at your existing OTLP endpoint and LLM calls will show up
      here automatically.
    </Alert>
  );
}
