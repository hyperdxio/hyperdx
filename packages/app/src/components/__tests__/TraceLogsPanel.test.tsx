import React from 'react';
import type { Control } from 'react-hook-form';
import {
  BuilderChartConfigWithDateRange,
  TLogSource,
} from '@hyperdx/common-utils/dist/types';
import { MantineProvider } from '@mantine/core';
import { act, fireEvent, render, screen } from '@testing-library/react';

const mockQueryStore: Record<string, unknown> = {};
const mockSetters: Record<string, jest.Mock> = {};
function setterFor(key: string) {
  if (!mockSetters[key]) mockSetters[key] = jest.fn();
  return mockSetters[key];
}

jest.mock('nuqs', () => {
  const actual = jest.requireActual('nuqs');
  return {
    ...actual,
    useQueryState: (key: string) => {
      if (!mockSetters[key]) mockSetters[key] = jest.fn();
      return [mockQueryStore[key] ?? null, mockSetters[key]];
    },
  };
});

type RowTableProps = {
  config?: BuilderChartConfigWithDateRange;
  sourceId?: string;
  highlightedLineId?: string;
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
      // The real table reads these off the context, not its props.
      mockRowTableContext.current = react.use(panel.RowSidePanelContext);
      return null;
    },
  };
});

type FilterForm = { logWhere: string; logWhereLanguage: string };

let mockStoredLanguage = 'lucene';

jest.mock('../SearchInput/SearchWhereInput', () => {
  const rhf =
    jest.requireActual<typeof import('react-hook-form')>('react-hook-form');
  return {
    __esModule: true,
    default: ({
      control,
      name,
      onSubmit,
    }: {
      control: Control<FilterForm>;
      name: keyof FilterForm;
      onSubmit?: () => void;
    }) => {
      // Surface the form's live value so a test can see what the user would.
      const value = rhf.useWatch({ control, name });
      const language = rhf.useWatch({ control, name: 'logWhereLanguage' });
      return (
        <>
          <span data-testid="log-filter-value">{String(value ?? '')}</span>
          <span data-testid="log-filter-language">
            {String(language ?? '')}
          </span>
          {/* Stands in for pressing enter in the real input. */}
          <button
            type="button"
            data-testid="submit-log-filter"
            onClick={onSubmit}
          >
            submit
          </button>
        </>
      );
    },
    getStoredLanguage: () => mockStoredLanguage,
  };
});

// A real context so `use(RowSidePanelContext)` works without pulling in the
// side panel (which imports this component back).
const mockToggleColumn = jest.fn();
jest.mock('../DBRowSidePanel', () => {
  const react = jest.requireActual<typeof React>('react');
  return {
    __esModule: true,
    RowSidePanelContext: react.createContext({
      // What the search page hands down: its own columns and their toggle.
      displayedColumns: ['Timestamp', 'Body'],
      toggleColumn: mockToggleColumn,
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

// Only the fields the panel reads; the rest of TLogSource is irrelevant here.
const asLogSource = (source: Record<string, unknown>) =>
  source as unknown as TLogSource;

const LOG_SOURCE = asLogSource({
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
});

function renderPanel({
  source = LOG_SOURCE,
  onNavigateToLog = jest.fn(),
  selectOverride,
  traceId = TRACE_ID,
}: {
  /** Null for a source that no longer resolves. */
  source?: TLogSource | null;
  onNavigateToLog?: jest.Mock;
  selectOverride?: string;
  traceId?: string;
} = {}) {
  mockUseSource.mockReturnValue({
    data: source ?? undefined,
    isLoading: false,
  });
  // A fresh element per render: React bails out of re-rendering an identical one.
  const tree = () => (
    <MantineProvider>
      <TraceLogsPanel
        logSourceId="log-src"
        traceId={traceId}
        dateRange={DATE_RANGE}
        selectOverride={selectOverride}
        onNavigateToLog={onNavigateToLog}
      />
    </MantineProvider>
  );
  const { rerender } = render(tree());
  return { onNavigateToLog, rerender: () => rerender(tree()) };
}

describe('TraceLogsPanel', () => {
  beforeEach(() => {
    Object.keys(mockQueryStore).forEach(k => delete mockQueryStore[k]);
    Object.keys(mockSetters).forEach(k => delete mockSetters[k]);
    mockRowTableProps.current = {};
    mockUseSource.mockReset();
    mockRowTableContext.current = {};
    mockToggleColumn.mockReset();
    mockStoredLanguage = 'lucene';
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
    // One page to start; the table pages on scroll from here.
    expect(config.limit).toEqual({ limit: 200 });
  });

  it("keeps the source's mandatory table filter ahead of the trace scope", () => {
    renderPanel({
      source: asLogSource({
        ...LOG_SOURCE,
        tableFilterExpression: "ServiceName != 'internal'",
      }),
    });

    const config = mockRowTableProps.current.config!;
    // Rows the source is configured to hide must stay hidden here too.
    expect(config.filters).toEqual([
      { type: 'sql', condition: "ServiceName != 'internal'" },
      { type: 'sql', condition: `TraceId='${TRACE_ID}'` },
    ]);
    // And the source id, which is how its querySettings reach the query.
    expect(config.source).toBe('log-src');
  });

  it('applies the waterfall log filter and its language from the URL', () => {
    mockQueryStore.logWhere = "SeverityText = 'error'";
    mockQueryStore.logWhereLanguage = 'sql';
    renderPanel();

    const config = mockRowTableProps.current.config!;
    expect(config.where).toBe("SeverityText = 'error'");
    expect(config.whereLanguage).toBe('sql');
  });

  it('runs a URL filter that carries no language as Lucene, as the waterfall does', () => {
    // A SQL editor preference must not reinterpret a filter the URL left
    // unlabelled — the waterfall would run it as Lucene.
    mockStoredLanguage = 'sql';
    mockQueryStore.logWhere = 'SeverityText:"error"';
    renderPanel();

    expect(mockRowTableProps.current.config?.whereLanguage).toBe('lucene');
    expect(screen.getByTestId('log-filter-language')).toHaveTextContent(
      'lucene',
    );
  });

  it('offers the stored editor preference when there is no filter to interpret', () => {
    mockStoredLanguage = 'sql';
    renderPanel();

    expect(screen.getByTestId('log-filter-language')).toHaveTextContent('sql');
  });

  describe('when the logs come from the searched source', () => {
    // The reader's chosen columns, which differ from the source default.
    const SEARCH_SELECT = 'Timestamp, Body';

    it("reuses the search's columns so row ids match the highlighted row", () => {
      renderPanel({ selectOverride: SEARCH_SELECT });

      const config = mockRowTableProps.current.config!;
      expect(config.select).toBe(SEARCH_SELECT);
      // ...while the trace scope and ordering still come from this panel.
      expect(config.filters).toEqual([
        { type: 'sql', condition: `TraceId='${TRACE_ID}'` },
      ]);
      expect(config.where).toBe('');
      expect(config.orderBy).toBe('Timestamp ASC');
      expect(config.dateRange).toBe(DATE_RANGE);
      // Source-level fields still come from the log source, not the config.
      expect(config.source).toBe('log-src');
    });

    it('leaves the remove-column action in place, since the columns are shared', () => {
      renderPanel({ selectOverride: SEARCH_SELECT });

      expect(mockRowTableContext.current.toggleColumn).toBe(mockToggleColumn);
    });
  });

  it('drops the remove-column action when showing its own columns', () => {
    // Otherwise the header's × maps by index onto the *search* table's select
    // and drops an unrelated column from the search results.
    renderPanel();

    expect(mockRowTableContext.current.toggleColumn).toBeUndefined();
    expect(mockRowTableContext.current.displayedColumns).toBeUndefined();
  });

  it('re-seeds the filter input when the URL filter changes underneath it', () => {
    mockQueryStore.logWhere = 'SeverityText:"error"';
    const { rerender } = renderPanel();
    expect(screen.getByTestId('log-filter-value')).toHaveTextContent(
      'SeverityText:"error"',
    );

    // Browser back restores an earlier filter without this form touching it.
    mockQueryStore.logWhere = 'ServiceName:"cart"';
    act(() => rerender());

    expect(screen.getByTestId('log-filter-value')).toHaveTextContent(
      'ServiceName:"cart"',
    );
    expect(mockRowTableProps.current.config?.where).toBe('ServiceName:"cart"');
  });

  it('submits the log filter without touching the spans filter', async () => {
    mockQueryStore.logWhere = 'SeverityText:"error"';
    mockQueryStore.logWhereLanguage = 'sql';
    renderPanel();

    await act(async () => {
      fireEvent.click(screen.getByTestId('submit-log-filter'));
    });

    expect(setterFor('logWhere')).toHaveBeenCalledWith('SeverityText:"error"');
    expect(setterFor('logWhereLanguage')).toHaveBeenCalledWith('sql');
    // The waterfall's own filter is not this form's to write.
    expect(setterFor('traceWhere')).not.toHaveBeenCalled();
    expect(setterFor('traceWhereLanguage')).not.toHaveBeenCalled();
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

  it('escapes a trace id that carries SQL metacharacters', () => {
    renderPanel({ traceId: "abc' OR 1=1--" });

    expect(mockRowTableProps.current.config?.filters).toEqual([
      { type: 'sql', condition: "TraceId='abc\\' OR 1=1--'" },
    ]);
  });

  it('explains itself when the correlated log source no longer resolves', () => {
    renderPanel({ source: null });

    expect(screen.getByText('Correlated log source not found')).toBeVisible();
    expect(mockRowTableProps.current.config).toBeUndefined();
  });

  it.each([
    ['undefined', undefined],
    ['whitespace', '   '],
  ])(
    'explains itself instead of querying when the trace id column is %s',
    (_label, traceIdExpression) => {
      renderPanel({
        source: asLogSource({ ...LOG_SOURCE, traceIdExpression }),
      });

      expect(screen.getByText('No trace ID column configured')).toBeVisible();
      expect(mockRowTableProps.current.config).toBeUndefined();
    },
  );
});
