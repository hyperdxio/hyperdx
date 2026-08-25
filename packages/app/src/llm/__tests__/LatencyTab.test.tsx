import { screen } from '@testing-library/react';

import { makeTraceSource } from '@/llm/__fixtures__/sources';
import { LatencyTab } from '@/llm/dashboard/LatencyTab';
import { getLLMExpressions, isLLMAttributeKey } from '@/llm/lib/expressions';

// Capture the props handed to the heatmap + delta composite.
const heatmapChartProps: any[] = [];
jest.mock('@/components/Search/DBSearchHeatmapChart', () => ({
  DBSearchHeatmapChart: (props: unknown) => {
    heatmapChartProps.push(props);
    return <div data-testid="search-heatmap-chart" />;
  },
}));

const TRACE_SOURCE = makeTraceSource();
const expressions = getLLMExpressions(TRACE_SOURCE, []);

const baseProps = {
  source: TRACE_SOURCE,
  expressions,
  dateRange: [new Date(0), new Date(1000)] as [Date, Date],
  where: '',
  whereLanguage: 'sql' as const,
  onWhereChange: jest.fn(),
};

describe('LatencyTab', () => {
  beforeEach(() => {
    heatmapChartProps.length = 0;
    jest.clearAllMocks();
  });

  it('scopes the heatmap to LLM spans (and session) without the cost alias', () => {
    renderWithMantine(<LatencyTab {...baseProps} sessionId="ses_123" />);

    expect(screen.getByTestId('search-heatmap-chart')).toBeInTheDocument();
    const { chartConfig, source } = heatmapChartProps[0];
    expect(source).toBe(TRACE_SOURCE);
    const conditions = chartConfig.filters.map((f: any) => f.condition);
    expect(conditions[0]).toBe(expressions.isLLMSpan);
    expect(conditions[1]).toContain("'ses_123'");
    // Delta sampling queries never reference cost; the WITH binding is
    // skipped to keep them small.
    expect(chartConfig.with).toBeUndefined();
  });

  it('pins AI-relevant attributes to the top of the delta breakdown', () => {
    renderWithMantine(<LatencyTab {...baseProps} />);
    expect(heatmapChartProps[0].isPriorityProperty).toBe(isLLMAttributeKey);
  });

  it('appends delta filter clicks to the where clause', () => {
    renderWithMantine(
      <LatencyTab {...baseProps} where="ServiceName = 'api'" />,
    );

    heatmapChartProps[0].onAddFilter(
      "SpanAttributes['gen_ai.request.model']",
      'gpt-5.1',
      'include',
    );
    expect(baseProps.onWhereChange).toHaveBeenCalledWith(
      "(ServiceName = 'api') AND SpanAttributes['gen_ai.request.model'] = 'gpt-5.1'",
    );

    heatmapChartProps[0].onAddFilter(
      "SpanAttributes['gen_ai.request.model']",
      'gpt-5.1',
      'exclude',
    );
    expect(baseProps.onWhereChange).toHaveBeenCalledWith(
      "(ServiceName = 'api') AND SpanAttributes['gen_ai.request.model'] != 'gpt-5.1'",
    );
  });

  it('builds lucene clauses when the where language is lucene', () => {
    renderWithMantine(
      <LatencyTab {...baseProps} whereLanguage="lucene" where="level:error" />,
    );

    heatmapChartProps[0].onAddFilter(
      "SpanAttributes['gen_ai.request.model']",
      'gpt-5.1',
      'exclude',
    );
    expect(baseProps.onWhereChange).toHaveBeenCalledWith(
      'level:error -SpanAttributes.gen_ai.request.model:"gpt-5.1"',
    );
  });
});
