import { screen } from '@testing-library/react';

import { makeLogSource, makeTraceSource } from '@/llm/__fixtures__/sources';
import { ErrorsTab } from '@/llm/dashboard/ErrorsTab';
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

describe('ErrorsTab', () => {
  beforeEach(() => {
    rowTableProps.length = 0;
  });

  it('renders trace and log tiles scoped to errors per source', () => {
    renderWithMantine(
      <ErrorsTab
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
    expect(traceConditions).toContain(expressions.isLLMSpan);
    // Scoped to error spans (lower(StatusCode) = 'error').
    expect(traceConditions).toContain(expressions.isError);
    expect(traceConditions.some((c: string) => c.includes("'ses_123'"))).toBe(
      true,
    );
    expect(traceConfig.orderBy[0].ordering).toBe('DESC');

    const logConfig = rowTableProps[1].config;
    expect(rowTableProps[1].sourceId).toBe('log-source');
    expect(logConfig.select).toBe(LOG_SOURCE.defaultTableSelectExpression);
    const logConditions = logConfig.filters.map((f: any) => f.condition);
    expect(logConditions).toContain(logExpressions.isLLMRelated);
    // Scoped to error-severity log events.
    expect(logConditions).toContain(logExpressions.isError);
    // Session matching on logs uses the log source's attribute column.
    const sessionCondition = logConditions.find((c: string) =>
      c.includes("'ses_123'"),
    );
    expect(sessionCondition).toContain("LogAttributes['session.id']");
  });

  it('renders only the trace tile without a log source', () => {
    renderWithMantine(<ErrorsTab {...baseProps} />);
    expect(screen.getAllByTestId('row-table')).toHaveLength(1);
    expect(
      screen.getByText(/Select a log source to also show/),
    ).toBeInTheDocument();
  });
});
