import { screen } from '@testing-library/react';

import { makeTraceSource } from '@/llm/__fixtures__/sources';
import { buildSessionRowHref, SessionsTab } from '@/llm/dashboard/SessionsTab';
import { getLLMExpressions, llmGatedSumExpr } from '@/llm/lib/expressions';

// Capture the chart config the tab hands to DBTableChart.
const tableChartProps: any[] = [];
jest.mock('@/components/DBTableChart', () => ({
  __esModule: true,
  default: (props: unknown) => {
    tableChartProps.push(props);
    return <div data-testid="table-chart" />;
  },
}));

// Reactive URL params for row-href construction (see buildSessionRowHref).
jest.mock('next/navigation', () => ({
  useSearchParams: () =>
    new URLSearchParams('tab=sessions&where=foo&from=1&to=2'),
}));

const TRACE_SOURCE = makeTraceSource();

describe('SessionsTab', () => {
  it('groups by the session id expression, scoped to LLM spans with sessions', () => {
    const expressions = getLLMExpressions(TRACE_SOURCE, []);
    renderWithMantine(
      <SessionsTab
        source={TRACE_SOURCE}
        expressions={expressions}
        dateRange={[new Date(0), new Date(1000)]}
        where=""
        whereLanguage="sql"
      />,
    );

    expect(screen.getByTestId('table-chart')).toBeInTheDocument();
    const config = tableChartProps[0].config;
    expect(config.groupBy).toBe('Session');
    const sessionSelect = config.select.find((s: any) => s.alias === 'Session');
    expect(sessionSelect.valueExpression).toBe(expressions.sessionId);

    // Scoped to LLM spans that actually carry a session id.
    const conditions = config.filters.map((f: any) => f.condition);
    expect(conditions).toContain(expressions.isLLMSpan);
    expect(conditions).toContain(expressions.hasSessionId);

    // Token/cost sums use the per-service provided-cost election so apps
    // emitting several instrumentation dialects in parallel don't double
    // count (and token-only apps aren't dropped by cost-reporting ones).
    const tokensSelect = config.select.find(
      (s: any) => s.alias === 'Total Tokens',
    );
    expect(tokensSelect.valueExpression).toBe(
      llmGatedSumExpr(expressions, expressions.totalTokens),
    );
    expect(tokensSelect.valueExpression).toContain(
      `toUInt64(${expressions.hasProvidedCost})`,
    );

    // start/end must be raw min()/max() expressions, not aggFn entries: the
    // chart builder coerces aggFn inputs via toFloat64OrDefault(toString(..)),
    // which breaks toString/dateDiff on DateTime aliases (regression).
    const startSelect = config.select.find((s: any) => s.alias === 'start_ts');
    const endSelect = config.select.find((s: any) => s.alias === 'end_ts');
    expect(startSelect).toEqual({
      alias: 'start_ts',
      valueExpression: 'min(Timestamp)',
    });
    expect(endSelect).toEqual({
      alias: 'end_ts',
      valueExpression: 'max(Timestamp)',
    });
  });

  it('builds row hrefs from the reactive URL params, preserving the tab', () => {
    // Regression: hrefs were built from a window.location snapshot, so rows
    // rendered from cache before an async tab-switch URL write landed baked
    // the previous tab into the link — clicking a session then navigated
    // back to the old tab underneath the drawer.
    const expressions = getLLMExpressions(TRACE_SOURCE, []);
    renderWithMantine(
      <SessionsTab
        source={TRACE_SOURCE}
        expressions={expressions}
        dateRange={[new Date(0), new Date(1000)]}
        where=""
        whereLanguage="sql"
      />,
    );

    const getRowSearchLink =
      tableChartProps[tableChartProps.length - 1].getRowSearchLink;
    expect(getRowSearchLink({ Session: 'ses_123' })).toBe(
      '/?tab=sessions&where=foo&from=1&to=2&llmSession=ses_123',
    );
  });
});

describe('buildSessionRowHref', () => {
  it('preserves existing params and sets llmSession', () => {
    expect(buildSessionRowHref('/llm', 'tab=sessions&from=1', 'ses_a')).toBe(
      '/llm?tab=sessions&from=1&llmSession=ses_a',
    );
    expect(buildSessionRowHref('/llm', '', 'ses_a')).toBe(
      '/llm?llmSession=ses_a',
    );
    // Replaces a previously open session rather than duplicating the param.
    expect(
      buildSessionRowHref('/llm', 'llmSession=ses_old&tab=sessions', 'ses_b'),
    ).toBe('/llm?llmSession=ses_b&tab=sessions');
  });
});
