import { screen } from '@testing-library/react';

import { makeLogSource, makeTraceSource } from '@/llm/__fixtures__/sources';
import { SearchTilesTab } from '@/llm/dashboard/SearchTilesTab';
import { getLLMExpressions, getLLMLogExpressions } from '@/llm/lib/expressions';

// Capture the configs handed to the row tables.
const rowTableProps: any[] = [];
jest.mock('@/components/DBSqlRowTableWithSidebar', () => ({
  __esModule: true,
  default: (props: unknown) => {
    rowTableProps.push(props);
    return <div data-testid="row-table" />;
  },
}));

const TRACE_SOURCE = makeTraceSource();

const LOG_SOURCE = makeLogSource();

const expressions = getLLMExpressions(TRACE_SOURCE, []);
const logExpressions = getLLMLogExpressions(LOG_SOURCE, []);

const baseProps = {
  source: TRACE_SOURCE,
  expressions,
  dateRange: [new Date(0), new Date(1000)] as [Date, Date],
  where: '',
  whereLanguage: 'sql' as const,
};

describe('SearchTilesTab', () => {
  beforeEach(() => {
    rowTableProps.length = 0;
  });

  it('renders trace and log tiles with per-source scope filters', () => {
    renderWithMantine(
      <SearchTilesTab
        {...baseProps}
        logSource={LOG_SOURCE}
        logExpressions={logExpressions}
        sessionId="ses_123"
      />,
    );

    expect(screen.getAllByTestId('row-table')).toHaveLength(2);

    const traceConfig = rowTableProps[0].config;
    expect(rowTableProps[0].sourceId).toBe('trace-source');
    expect(traceConfig.select).toBe(TRACE_SOURCE.defaultTableSelectExpression);
    const traceConditions = traceConfig.filters.map((f: any) => f.condition);
    expect(traceConditions[0]).toBe(expressions.isLLMSpan);
    expect(traceConditions[1]).toContain("'ses_123'");
    expect(traceConfig.orderBy[0].ordering).toBe('DESC');

    const logConfig = rowTableProps[1].config;
    expect(rowTableProps[1].sourceId).toBe('log-source');
    expect(logConfig.select).toBe(LOG_SOURCE.defaultTableSelectExpression);
    const logConditions = logConfig.filters.map((f: any) => f.condition);
    expect(logConditions[0]).toBe(logExpressions.isLLMRelated);
    // Session matching on logs uses the log source's attribute column.
    expect(logConditions[1]).toContain("LogAttributes['session.id']");
    expect(logConditions[1]).toContain("'ses_123'");
  });

  it('renders only the trace tile without a log source', () => {
    renderWithMantine(<SearchTilesTab {...baseProps} />);
    expect(screen.getAllByTestId('row-table')).toHaveLength(1);
    expect(
      screen.getByText(/Select a log source to also show/),
    ).toBeInTheDocument();
  });
});
