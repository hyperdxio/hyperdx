import React from 'react';
import { TLogSource } from '@hyperdx/common-utils/dist/types';
import { MantineProvider } from '@mantine/core';
import { act, render, screen } from '@testing-library/react';

const mockQueryStore: Record<string, unknown> = {};
jest.mock('nuqs', () => {
  const actual = jest.requireActual('nuqs');
  return {
    ...actual,
    useQueryState: (key: string) => [mockQueryStore[key] ?? null, jest.fn()],
  };
});

type RowTableProps = {
  config?: Record<string, any>;
  sourceId?: string;
  highlightedLineId?: string;
  onRowDetailsClick?: (
    rowWhere: { where: string; aliasWith: unknown[] },
    row: Record<string, unknown>,
  ) => void;
};
const mockRowTableProps: { current: RowTableProps } = { current: {} };
jest.mock('../DBRowTable', () => ({
  __esModule: true,
  DBSqlRowTable: (props: RowTableProps) => {
    mockRowTableProps.current = props;
    return null;
  },
}));

jest.mock('../SearchInput/SearchWhereInput', () => ({
  __esModule: true,
  default: () => null,
  getStoredLanguage: () => 'lucene',
}));

// A real context so `use(RowSidePanelContext)` works without pulling in the
// side panel (which imports this component back).
jest.mock('../DBRowSidePanel', () => {
  const react = jest.requireActual<typeof React>('react');
  return {
    __esModule: true,
    RowSidePanelContext: react.createContext({}),
    deriveRowSidePanelContextForSource: (parent: unknown) => parent,
  };
});

const mockUseSource = jest.fn();
jest.mock('@/source', () => ({
  __esModule: true,
  useSource: (args: unknown) => mockUseSource(args),
  getEventBody: (source: { bodyExpression?: string }) => source.bodyExpression,
}));

// NOTE: imported after the mock factories above.
import TraceLogsPanel from '@/components/TraceLogsPanel';

const TRACE_ID = '7316d5a2ab0dc2efa72258f64a98a405';
const DATE_RANGE: [Date, Date] = [
  new Date('2024-05-01T09:00:00Z'),
  new Date('2024-05-01T11:00:00Z'),
];

// eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
const LOG_SOURCE = {
  id: 'log-src',
  kind: 'log',
  name: 'Demo logs',
  connection: 'conn',
  from: { databaseName: 'default', tableName: 'otel_logs' },
  timestampValueExpression: 'Timestamp',
  defaultTableSelectExpression: 'Timestamp, ServiceName, SeverityText, Body',
  bodyExpression: 'Body',
  implicitColumnExpression: 'Body',
  traceIdExpression: 'TraceId',
} as TLogSource;

function renderPanel({
  source = LOG_SOURCE,
  onNavigateToLog = jest.fn(),
}: {
  source?: TLogSource;
  onNavigateToLog?: jest.Mock;
} = {}) {
  mockUseSource.mockReturnValue({ data: source, isLoading: false });
  render(
    <MantineProvider>
      <TraceLogsPanel
        logSourceId="log-src"
        traceId={TRACE_ID}
        dateRange={DATE_RANGE}
        onNavigateToLog={onNavigateToLog}
      />
    </MantineProvider>,
  );
  return { onNavigateToLog };
}

describe('TraceLogsPanel', () => {
  beforeEach(() => {
    Object.keys(mockQueryStore).forEach(k => delete mockQueryStore[k]);
    mockRowTableProps.current = {};
    mockUseSource.mockReset();
  });

  it('scopes the table to the trace without spending the where clause', () => {
    renderPanel();

    const config = mockRowTableProps.current.config!;
    expect(config.filters).toEqual([
      { type: 'sql', condition: `TraceId='${TRACE_ID}'` },
    ]);
    expect(config.where).toBe('');
    expect(config.select).toBe(LOG_SOURCE.defaultTableSelectExpression);
    // Chronological: inside a trace that is execution order.
    expect(config.orderBy).toBe('Timestamp ASC');
    expect(config.dateRange).toBe(DATE_RANGE);
  });

  it('applies the waterfall log filter and its language from the URL', () => {
    mockQueryStore.logWhere = "SeverityText = 'error'";
    mockQueryStore.logWhereLanguage = 'sql';
    renderPanel();

    const config = mockRowTableProps.current.config!;
    expect(config.where).toBe("SeverityText = 'error'");
    expect(config.whereLanguage).toBe('sql');
  });

  it("labels a picked row with the log's body", () => {
    const { onNavigateToLog } = renderPanel();

    act(() =>
      mockRowTableProps.current.onRowDetailsClick?.(
        { where: 'row-2', aliasWith: [] },
        { Body: 'upstream timeout' },
      ),
    );

    expect(onNavigateToLog).toHaveBeenCalledWith(
      'row-2',
      [],
      'upstream timeout',
    );
  });

  it('falls back to a generic label when the body column is not selected', () => {
    const { onNavigateToLog } = renderPanel();

    act(() =>
      mockRowTableProps.current.onRowDetailsClick?.(
        { where: 'row-2', aliasWith: [] },
        { ServiceName: 'cart' },
      ),
    );

    expect(onNavigateToLog).toHaveBeenCalledWith('row-2', [], 'Log');
  });

  it('explains itself instead of querying when the log source has no trace id column', () => {
    renderPanel({
      source: { ...LOG_SOURCE, traceIdExpression: undefined } as TLogSource,
    });

    expect(screen.getByText('No trace ID column configured')).toBeVisible();
    expect(mockRowTableProps.current.config).toBeUndefined();
  });
});
