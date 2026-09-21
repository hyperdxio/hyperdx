import React from 'react';
import {
  BuilderChartConfigWithDateRange,
  SourceKind,
  TLogSource,
} from '@hyperdx/common-utils/dist/types';
import { MantineProvider } from '@mantine/core';
import { act, render, screen } from '@testing-library/react';

type RowTableProps = {
  config?: BuilderChartConfigWithDateRange;
  sourceId?: string;
  tableId?: string;
  initialSortBy?: { id: string; desc: boolean }[];
  onRowDetailsClick?: (
    rowWhere: { where: string; aliasWith: unknown[] },
    row: Record<string, unknown>,
  ) => void;
};
const mockRowTableProps: { current: RowTableProps } = { current: {} };
const mockRowTableContext: { current: Record<string, unknown> } = {
  current: {},
};
jest.mock('../DBRowTable', () => {
  const react = jest.requireActual<typeof React>('react');
  const panel = jest.requireMock<{
    RowSidePanelContext: React.Context<Record<string, unknown>>;
  }>('../DBRowSidePanel');
  return {
    __esModule: true,
    DBSqlRowTable: (props: RowTableProps) => {
      mockRowTableProps.current = props;
      mockRowTableContext.current = react.use(panel.RowSidePanelContext);
      return null;
    },
  };
});

jest.mock('../DBRowSidePanel', () => {
  const react = jest.requireActual<typeof React>('react');
  return {
    __esModule: true,
    RowSidePanelContext: react.createContext({
      displayedColumns: ['Timestamp', 'Body'],
      toggleColumn: jest.fn(),
      onPropertyAddClick: jest.fn(),
      generateSearchUrl: ({
        where,
        whereLanguage,
        source,
      }: {
        where: string;
        whereLanguage: string;
        source?: { id: string };
      }) =>
        `/search?where=${encodeURIComponent(where)}&whereLanguage=${whereLanguage}&source=${source?.id}`,
    }),
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

const LOG_SOURCE: TLogSource = {
  id: 'log-src',
  kind: SourceKind.Log,
  name: 'Demo logs',
  connection: 'conn',
  from: { databaseName: 'default', tableName: 'otel_logs' },
  timestampValueExpression: 'Timestamp',
  defaultTableSelectExpression: 'Timestamp, ServiceName, SeverityText, Body',
  bodyExpression: 'Body',
  implicitColumnExpression: 'Body',
  traceIdExpression: 'TraceId',
};

function renderPanel({
  source = LOG_SOURCE,
  onNavigateToLog = jest.fn(),
  traceId = TRACE_ID,
}: {
  /** Null for a source that no longer resolves. */
  source?: TLogSource | null;
  onNavigateToLog?: jest.Mock;
  traceId?: string;
} = {}) {
  mockUseSource.mockReturnValue({
    data: source ?? undefined,
    isLoading: false,
  });
  render(
    <MantineProvider>
      <TraceLogsPanel
        logSourceId="log-src"
        traceId={traceId}
        dateRange={DATE_RANGE}
        onNavigateToLog={onNavigateToLog}
      />
    </MantineProvider>,
  );
  return { onNavigateToLog };
}

function searchParams() {
  const href = screen
    .getByTestId('trace-logs-open-in-search')
    .getAttribute('href')!;
  return new URLSearchParams(href.split('?')[1]);
}

describe('TraceLogsPanel', () => {
  beforeEach(() => {
    mockRowTableProps.current = {};
    mockRowTableContext.current = {};
    mockUseSource.mockReset();
  });

  it('scopes the table to the trace', () => {
    renderPanel();

    const config = mockRowTableProps.current.config!;
    expect(config.where).toBe(`TraceId = '${TRACE_ID}'`);
    expect(config.whereLanguage).toBe('sql');
    expect(config.select).toBe(LOG_SOURCE.defaultTableSelectExpression);
    expect(config.orderBy).toBe('Timestamp ASC');
    expect(config.dateRange).toBe(DATE_RANGE);
    expect(config.limit).toEqual({ limit: 200 });
  });

  it("keeps the source's mandatory table filter", () => {
    renderPanel({
      source: {
        ...LOG_SOURCE,
        tableFilterExpression: "ServiceName != 'internal'",
      },
    });

    const config = mockRowTableProps.current.config!;
    expect(config.filters).toEqual([
      { type: 'sql', condition: "ServiceName != 'internal'" },
    ]);
    expect(config.source).toBe('log-src');
  });

  it('escapes a trace id that carries SQL metacharacters', () => {
    renderPanel({ traceId: "abc' OR 1=1--" });

    expect(mockRowTableProps.current.config?.where).toBe(
      "TraceId = 'abc\\' OR 1=1--'",
    );
  });

  it("drops the searched table's row actions", () => {
    renderPanel();

    expect(mockRowTableContext.current.toggleColumn).toBeUndefined();
    expect(mockRowTableContext.current.displayedColumns).toBeUndefined();
    expect(mockRowTableContext.current.onPropertyAddClick).toBeUndefined();
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

  it('links to a search that reproduces the table', () => {
    renderPanel();

    const params = searchParams();
    expect(params.get('source')).toBe('log-src');
    expect(params.get('whereLanguage')).toBe('sql');
    expect(params.get('from')).toBe(DATE_RANGE[0].getTime().toString());
    expect(params.get('to')).toBe(DATE_RANGE[1].getTime().toString());
    // `parseAsStringEncoded` decodes one level past the query string's own.
    expect(decodeURIComponent(params.get('where')!)).toBe(
      `TraceId = '${TRACE_ID}'`,
    );
    expect(decodeURIComponent(params.get('select')!)).toBe(
      LOG_SOURCE.defaultTableSelectExpression,
    );
    expect(params.get('orderBy')).toBeNull();
  });

  it('tells the table its own identity and sort state', () => {
    renderPanel();

    expect(mockRowTableProps.current.tableId).toBe('trace-logs');
    expect(mockRowTableProps.current.initialSortBy).toEqual([
      { id: 'Timestamp', desc: false },
    ]);
  });

  it.each([
    ['the source no longer resolves', { source: null }],
    [
      'the source has no trace id column',
      { source: { ...LOG_SOURCE, traceIdExpression: undefined } },
    ],
    // `min(1)` on the schema accepts a space.
    [
      'the trace id column is whitespace',
      { source: { ...LOG_SOURCE, traceIdExpression: '  ' } },
    ],
  ])('explains itself instead of querying when %s', (_label, props) => {
    renderPanel(props);

    expect(screen.getByText('Correlated logs unavailable')).toBeVisible();
    expect(mockRowTableProps.current.config).toBeUndefined();
  });
});
