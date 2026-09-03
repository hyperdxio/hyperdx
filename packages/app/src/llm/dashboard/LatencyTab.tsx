import { useCallback, useMemo } from 'react';
import { tcFromSource } from '@hyperdx/common-utils/dist/core/metadata';
import { Box } from '@mantine/core';

import type { AddFilterFn } from '@/components/DBDeltaChart';
import { DBSearchHeatmapChart } from '@/components/Search/DBSearchHeatmapChart';
import { useJsonColumns } from '@/hooks/useMetadata';
import { isLLMAttributeKey } from '@/llm/lib/expressions';

import {
  appendWhereClause,
  baseLLMChartConfig,
  buildDeltaFilterClause,
  buildTrimmedDeltaSelect,
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

  // Trim oversized attribute values (full conversation payloads) out of the
  // delta sampling rows server-side; see buildTrimmedDeltaSelect.
  const { data: jsonColumns } = useJsonColumns(tcFromSource(source));
  const deltaSelectExpression = useMemo(
    () => buildTrimmedDeltaSelect(source, jsonColumns),
    [source, jsonColumns],
  );

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

  // Hold all queries until the JSON-column lookup resolves so a JSON-typed
  // attribute column never receives a mapFilter select. On this page the
  // lookup is already cached by useLLMDashboardExpressions, so this resolves
  // on first render.
  if (jsonColumns == null) {
    return (
      <Box
        style={{ height: 'calc(100vh - 240px)', minHeight: 500 }}
        data-testid="llm-latency-tab"
      />
    );
  }

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
        deltaSelectExpression={deltaSelectExpression}
      />
    </Box>
  );
}
