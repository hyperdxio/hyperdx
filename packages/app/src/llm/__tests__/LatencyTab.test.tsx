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

// Controls the JSON-column lookup per test (undefined = still loading).
let mockJsonColumns: string[] | undefined = [];
jest.mock('@/hooks/useMetadata', () => ({
  useJsonColumns: () => ({ data: mockJsonColumns }),
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
    mockJsonColumns = [];
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

  it('trims oversized attribute values out of the delta sampling rows', () => {
    renderWithMantine(<LatencyTab {...baseProps} />);
    expect(heatmapChartProps[0].deltaSelectExpression).toContain(
      'mapFilter((k, v) -> length(v) <= 256, SpanAttributes) AS SpanAttributes',
    );
    expect(heatmapChartProps[0].deltaSelectExpression).toContain(
      '* EXCEPT (SpanAttributes)',
    );
  });

  it('keeps * and holds queries for JSON-typed attribute columns', () => {
    mockJsonColumns = ['SpanAttributes'];
    renderWithMantine(<LatencyTab {...baseProps} />);
    expect(heatmapChartProps[0].deltaSelectExpression).toBe('*');
  });

  it('does not mount the chart until the JSON-column lookup resolves', () => {
    mockJsonColumns = undefined;
    renderWithMantine(<LatencyTab {...baseProps} />);
    expect(heatmapChartProps).toHaveLength(0);
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
