import { screen } from '@testing-library/react';

import { makeTraceSource } from '@/llm/__fixtures__/sources';
import { SessionsTab } from '@/llm/dashboard/SessionsTab';
import { getLLMExpressions } from '@/llm/lib/expressions';

// Capture the chart config the tab hands to DBTableChart.
const tableChartProps: any[] = [];
jest.mock('@/components/DBTableChart', () => ({
  __esModule: true,
  default: (props: unknown) => {
    tableChartProps.push(props);
    return <div data-testid="table-chart" />;
  },
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

    // Token/cost sums are gated on authoritative usage reporters.
    const tokensSelect = config.select.find(
      (s: any) => s.alias === 'Total Tokens',
    );
    expect(tokensSelect.aggCondition).toBe(expressions.hasReportedTokens);

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
});
