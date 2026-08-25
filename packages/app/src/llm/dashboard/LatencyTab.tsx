import { useCallback, useMemo } from 'react';
import { Box } from '@mantine/core';

import type { AddFilterFn } from '@/components/DBDeltaChart';
import { DBSearchHeatmapChart } from '@/components/Search/DBSearchHeatmapChart';
import { isLLMAttributeKey } from '@/llm/lib/expressions';

import {
  appendWhereClause,
  baseLLMChartConfig,
  buildDeltaFilterClause,
} from './chartConfig';
import { LLMChartProps } from './types';

/**
 * Latency tab: a drag-to-select duration heatmap over LLM spans with an
 * attribute delta breakdown (same interaction as the search page's delta
 * mode). Selecting a region compares the selected spans against the rest and
 * ranks the attributes that differ; clicking include/exclude on a value
 * appends the condition to the dashboard's where input, scoping every tab.
 */
export function LatencyTab(
  props: LLMChartProps & { onWhereChange: (where: string) => void },
) {
  const {
    source,
    expressions,
    dateRange,
    where,
    whereLanguage,
    sessionId,
    onWhereChange,
  } = props;

  // The heatmap and delta sampling queries never reference the cost alias;
  // skip the (catalog-sized) WITH binding to keep them small.
  const chartConfig = useMemo(
    () => ({
      ...baseLLMChartConfig({
        source,
        expressions,
        dateRange,
        where,
        whereLanguage,
        sessionId,
        withCostAlias: false,
      }),
      select: '',
    }),
    [source, expressions, dateRange, where, whereLanguage, sessionId],
  );

  const handleAddFilter = useCallback<NonNullable<AddFilterFn>>(
    (property, value, action) => {
      const clause = buildDeltaFilterClause(
        property,
        value,
        action,
        whereLanguage,
      );
      onWhereChange(appendWhereClause(where, clause, whereLanguage));
    },
    [where, whereLanguage, onWhereChange],
  );

  return (
    <Box
      style={{ height: 'calc(100vh - 240px)', minHeight: 500 }}
      data-testid="llm-latency-tab"
    >
      <DBSearchHeatmapChart
        chartConfig={chartConfig}
        source={source}
        isReady
        onAddFilter={handleAddFilter}
        isPriorityProperty={isLLMAttributeKey}
      />
    </Box>
  );
}
