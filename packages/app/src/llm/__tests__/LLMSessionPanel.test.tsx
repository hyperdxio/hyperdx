import { fireEvent, screen } from '@testing-library/react';

import { makeTraceSource } from '@/llm/__fixtures__/sources';
import { LLMSessionPanel } from '@/llm/dashboard/LLMSessionPanel';
import { getLLMExpressions } from '@/llm/lib/expressions';

// The drawer opens off the llmSession query param.
jest.mock('nuqs', () => ({
  parseAsString: {},
  useQueryState: (key: string) => [
    key === 'llmSession' ? 'ses_123' : null,
    jest.fn(),
  ],
}));

// Capture every chart query the panel issues.
const queryConfigs: any[] = [];
let mockListRows: Record<string, unknown>[] = [];
jest.mock('@/hooks/useChartConfig', () => ({
  useQueriedChartConfig: (config: any, opts: any) => {
    queryConfigs.push({ config, queryKey: opts?.queryKey });
    const key = Array.isArray(opts?.queryKey) ? opts.queryKey[0] : '';
    if (key === 'llm-session-spans') {
      return { data: { data: mockListRows }, isLoading: false };
    }
    if (key === 'llm-session-totals') {
      return {
        data: {
          data: [{ span_count: 708, total_tokens: 500, total_cost: 1.5 }],
        },
        isLoading: false,
      };
    }
    return { data: { data: [] }, isLoading: false };
  },
}));

const TRACE_SOURCE = makeTraceSource();

const expressions = getLLMExpressions(TRACE_SOURCE, []);

const renderPanel = () =>
  renderWithMantine(
    <LLMSessionPanel
      source={TRACE_SOURCE}
      expressions={expressions}
      dateRange={[new Date(0), new Date(1000)]}
      where=""
      whereLanguage="sql"
    />,
  );

describe('LLMSessionPanel', () => {
  beforeEach(() => {
    queryConfigs.length = 0;
    mockListRows = [
      {
        ts: '2026-08-24 19:12:58.173',
        spanName: 'opencode.llm',
        spanId: 'span-1',
        traceId: 'trace-1',
        model: 'claude-fable-5',
        toolName: '',
        totalTokens: 545,
        costUsd: 0.01,
      },
    ];
  });

  it('lists spans with a lightweight query — never the raw attribute map', () => {
    renderPanel();

    const listQuery = queryConfigs.find(
      q => q.queryKey?.[0] === 'llm-session-spans',
    );
    const aliases = listQuery.config.select.map((s: any) => s.alias);
    expect(aliases).toEqual(
      expect.arrayContaining([
        'ts',
        'spanName',
        'spanId',
        'traceId',
        'model',
        'costUsd',
      ]),
    );
    // Regression: selecting attributes shipped ~50 MiB per session.
    const selectExprs = listQuery.config.select.map(
      (s: any) => s.valueExpression,
    );
    expect(selectExprs).not.toContain('SpanAttributes');
    expect(listQuery.config.limit).toEqual({ limit: 100 });
  });

  it('shows aggregate totals and a truncation notice', () => {
    renderPanel();
    expect(
      screen.getByText(/Showing the first 100 of 708 spans/),
    ).toBeInTheDocument();
    expect(screen.getByTestId('llm-token-usage')).toBeInTheDocument();
  });

  it('fetches span attributes lazily, only on expand', () => {
    renderPanel();

    // No detail query while collapsed.
    expect(
      queryConfigs.some(q => q.queryKey?.[0] === 'llm-session-span-detail'),
    ).toBe(false);

    fireEvent.click(screen.getByText('opencode.llm'));

    const detailQuery = queryConfigs.find(
      q => q.queryKey?.[0] === 'llm-session-span-detail',
    );
    expect(detailQuery).toBeDefined();
    // Trace identity: span ids alone can collide (or be empty) across traces.
    expect(detailQuery.config.where).toContain("TraceId = 'trace-1'");
    expect(detailQuery.config.where).toContain("SpanId = 'span-1'");
    // Bounded to the searched window so the point lookup can prune partitions.
    expect(detailQuery.config.dateRange).toEqual([new Date(0), new Date(1000)]);
    expect(detailQuery.config.limit).toEqual({ limit: 1 });
    expect(detailQuery.config.select).toEqual([
      { alias: 'attributes', valueExpression: 'SpanAttributes' },
    ]);
  });
});
