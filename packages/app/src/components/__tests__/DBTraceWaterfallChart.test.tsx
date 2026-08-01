import React from 'react';
import {
  SourceKind,
  TLogSource,
  TTraceSource,
} from '@hyperdx/common-utils/dist/types';
import { screen, waitFor } from '@testing-library/react';
import { renderHook } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { RowSidePanelContext } from '@/components/DBRowSidePanel';
import {
  computeCollapseAll,
  computeCollapseOneLevel,
  computeExpandOneLevel,
  computeToggleCollapse,
  DBTraceWaterfallChartContainer,
  getDescendantIds,
  SpanRow,
  useEventsAroundFocus,
} from '@/components/DBTraceWaterfallChart';
import { TimelineChart } from '@/components/TimelineChart';
import useOffsetPaginatedQuery from '@/hooks/useOffsetPaginatedQuery';
import useRowWhere from '@/hooks/useRowWhere';

// Mock setup
jest.mock('@/components/TimelineChart', () => {
  const flattenText = (value: React.ReactNode): string => {
    if (value == null || typeof value === 'boolean') {
      return '';
    }

    if (typeof value === 'string' || typeof value === 'number') {
      return String(value);
    }

    if (Array.isArray(value)) {
      return value.map(flattenText).join('');
    }

    if (React.isValidElement<{ children?: React.ReactNode }>(value)) {
      return flattenText(value.props.children);
    }

    return '';
  };

  const mockComponent = function MockTimelineChart(props: any) {
    mockComponent.latestProps = props;
    return (
      <div data-testid="timeline-chart">
        TimelineChart
        {props.rows?.map((row: any) => (
          <div key={row.id}>
            {row.events?.map((event: any) => flattenText(event.body))}
          </div>
        ))}
      </div>
    );
  };
  mockComponent.latestProps = {};

  const MockTimelineMinimap = function MockTimelineMinimap(props: any) {
    MockTimelineMinimap.latestProps = props;
    return <div data-testid="timeline-minimap">TimelineMinimap</div>;
  };
  MockTimelineMinimap.latestProps = {};

  return { TimelineChart: mockComponent, TimelineMinimap: MockTimelineMinimap };
});

jest.mock('@/hooks/useOffsetPaginatedQuery');
jest.mock('@/hooks/useRowWhere');
jest.mock('../DBRowDataPanel', () => ({
  getJSONColumnNames: jest.fn().mockReturnValue([]),
}));

// Lightweight stub: the real SearchWhereInput renders SearchInputV2, which
// pulls in useMe()/metadata hooks that require a QueryClientProvider not present
// in this harness. We only care that the right inputs render, so stub it to a
// plain element carrying the data-testid.
jest.mock('@/components/SearchInput/SearchWhereInput', () => ({
  __esModule: true,
  default: ({ 'data-testid': dataTestId, name }: any) => (
    <div data-testid={dataTestId ?? `${name}-input`}>{name}</div>
  ),
  getStoredLanguage: () => 'lucene',
}));

const makeWaterfallSearchState = () => ({
  traceWhere: '',
  logWhere: '',
  traceWhereLanguage: '',
  logWhereLanguage: '',
  clear: jest.fn(),
  isFilterActive: false,
  isFilterExpanded: false,
  setIsFilterExpanded: jest.fn(),
  onSubmit: jest.fn(),
});

const mockUseWaterfallSearchState: jest.Mock = jest.fn(
  makeWaterfallSearchState,
);

jest.mock('@/hooks/useWaterfallSearchState', () => ({
  __esModule: true,
  default: (...args: any[]) => mockUseWaterfallSearchState(...args),
}));

const mockUseOffsetPaginatedQuery = useOffsetPaginatedQuery as jest.Mock;
const mockUseRowWhere = useRowWhere as jest.Mock;
const MockTimelineChart = TimelineChart as any;

describe('DBTraceWaterfallChartContainer', () => {
  // Common test data
  const mockTraceTableSource: TTraceSource = {
    id: 'trace-source-id',
    kind: SourceKind.Trace,
    name: 'trace-source',
    from: { databaseName: 'test_db', tableName: 'trace_table' },
    timestampValueExpression: 'Timestamp',
    defaultTableSelectExpression: 'Timestamp',
    durationExpression: 'Duration',
    durationPrecision: 9,
    traceIdExpression: 'TraceId',
    spanIdExpression: 'SpanId',
    parentSpanIdExpression: 'ParentSpanId',
    statusCodeExpression: 'StatusCode',
    serviceNameExpression: 'ServiceName',
    spanNameExpression: 'SpanName',
    spanKindExpression: 'SpanKind',
    eventAttributesExpression: 'SpanAttributes',
    implicitColumnExpression: 'Body',
    connection: 'conn1',
  };

  const mockLogTableSource: TLogSource = {
    id: 'log-source-id',
    kind: SourceKind.Log,
    name: 'log-source',
    from: { databaseName: 'test_db', tableName: 'log_table' },
    timestampValueExpression: 'Timestamp',
    defaultTableSelectExpression: 'Timestamp',
    implicitColumnExpression: 'Body',
    connection: 'conn2',
  };

  const mockDateRange = [
    new Date('2024-01-01T00:00:00.000Z'),
    new Date('2024-01-01T01:00:00.000Z'),
  ] as [Date, Date];
  const mockFocusDate = new Date('2024-01-01T00:30:00.000Z');
  const mockTraceId = 'test-trace-id';

  // Sample data
  const mockTraceData = {
    data: [
      {
        Body: 'test span',
        Timestamp: '2024-01-01T06:00:00.000000000Z',
        Duration: 0.1,
        SpanId: 'span-1',
        ParentSpanId: '',
        ServiceName: 'test-service',
        HyperDXEventType: 'span' as const,
        type: 'trace',
      } as SpanRow,
    ],
    meta: [{ totalCount: 1 }],
  };

  const mockLogData = {
    data: [
      {
        Body: 'test log',
        Timestamp: '2024-01-01T06:00:00.000000000Z',
        SpanId: 'span-1', // same span id to test correlation
        SeverityText: 'warn',
        HyperDXEventType: 'log',
        type: 'log',
      },
    ],
    meta: [{ totalCount: 1 }],
  };

  const emptyData = { data: [], meta: [] };

  // Reset mocks before each test
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseRowWhere.mockReturnValue(() => ({ where: 'row-id', aliasWith: [] }));
    MockTimelineChart.latestProps = {};
    mockUseWaterfallSearchState.mockReturnValue(makeWaterfallSearchState());
  });

  // Helper functions
  const renderComponent = (
    logTableSource: typeof mockLogTableSource | null = mockLogTableSource,
    traceId: string = mockTraceId,
  ) => {
    return renderWithMantine(
      <RowSidePanelContext.Provider value={{}}>
        <DBTraceWaterfallChartContainer
          traceTableSource={mockTraceTableSource}
          logTableSource={logTableSource}
          traceId={traceId}
          dateRange={mockDateRange}
          focusDate={mockFocusDate}
        />
      </RowSidePanelContext.Provider>,
    );
  };

  const waitForLoading = async () => {
    await waitFor(() => {
      expect(screen.getByTestId('timeline-chart')).toBeInTheDocument();
    });
  };

  // Content-based query mock. The waterfall runs, per source, a filtered query
  // (with a computed `__hdx_hidden` column) plus an unfiltered fallback query
  // that only fires when the filtered query errors. Keying responses off the
  // query shape (table, before/after window, presence of the filter column,
  // enabled flag) rather than call order keeps the mock stable as the number of
  // queries changes.
  //
  // - `traceError`/`logError`: fatal — every query for that source fails.
  // - `traceFilterError`/`logFilterError`: only the *filtered* query fails, so
  //   the unfiltered fallback still returns data.
  const setupQueryMocks = (options: {
    traceData?: typeof mockTraceData | typeof emptyData;
    logData?: typeof mockLogData | typeof emptyData;
    traceError?: Error;
    logError?: Error;
    traceFilterError?: Error;
    logFilterError?: Error;
    isFetching?: boolean;
  }) => {
    const {
      traceData = emptyData,
      logData = emptyData,
      traceError,
      logError,
      traceFilterError,
      logFilterError,
      isFetching = false,
    } = options;

    mockUseOffsetPaginatedQuery.mockReset();
    mockUseOffsetPaginatedQuery.mockImplementation((query: any, opts: any) => {
      // Disabled queries never fire (mirrors react-query).
      if (opts?.enabled === false) {
        return { data: undefined, isFetching: false, error: undefined };
      }
      const isLog = query?.from?.tableName === 'log_table';
      const isBefore = query?.dateRangeStartInclusive === true;
      const isFiltered =
        Array.isArray(query?.select) &&
        query.select.some((s: any) => s?.alias === '__hdx_hidden');

      const fatal = isLog ? logError : traceError;
      if (fatal) {
        return { data: undefined, isFetching, error: fatal };
      }
      const filterErr = isLog ? logFilterError : traceFilterError;
      if (filterErr && isFiltered) {
        return { data: undefined, isFetching, error: filterErr };
      }

      const data = isLog ? logData : traceData;
      return {
        data: isBefore ? data : emptyData,
        isFetching,
        error: undefined,
      };
    });
  };

  // Test cases
  it('renders loading state when data is being fetched', () => {
    mockUseOffsetPaginatedQuery.mockReturnValue({
      data: undefined,
      isFetching: true,
    });
    renderComponent();
    expect(screen.getByText('Loading Traces...')).toBeInTheDocument();
  });

  it('renders TimelineChart with trace data only', async () => {
    setupQueryMocks({ traceData: mockTraceData });
    renderComponent(null); // No log table source
    await waitForLoading();

    // Verify the chart received the correct data
    expect(MockTimelineChart.latestProps.rows.length).toBe(1);
    expect(MockTimelineChart.latestProps.rows[0]).toBeTruthy();
  });

  it('renders TimelineChart with both trace and log data', async () => {
    setupQueryMocks({
      traceData: mockTraceData,
      logData: mockLogData,
    });

    renderComponent(); // With log table source
    await waitForLoading();

    // Verify both trace and log data are present
    expect(MockTimelineChart.latestProps.rows.length).toBe(2);
    expect(MockTimelineChart.latestProps.rows[0]).toBeTruthy(); // Trace row
    expect(MockTimelineChart.latestProps.rows[1]).toBeTruthy(); // Log row
  });

  it('renders empty state when no data is available', async () => {
    mockUseOffsetPaginatedQuery.mockReturnValue({
      data: emptyData,
      isFetching: false,
    });

    renderComponent();

    await waitFor(() => {
      expect(
        screen.getByText('No matching spans or logs found'),
      ).toBeInTheDocument();
    });
  });

  it('escapes trace ids in the generated where clause', () => {
    setupQueryMocks({ traceData: mockTraceData });

    renderComponent(mockLogTableSource, "trace'with-quote");

    expect(mockUseOffsetPaginatedQuery).toHaveBeenCalled();
    expect(mockUseOffsetPaginatedQuery.mock.calls[0][0].where).toBe(
      "TraceId = 'trace\\'with-quote'",
    );
  });

  it('renders HTTP spans with URL information', async () => {
    // HTTP span with URL and method information
    const mockHttpSpanData = {
      data: [
        {
          Body: 'http span',
          Timestamp: '2024-01-01T06:00:00.000000000Z',
          Duration: 0.15,
          SpanId: 'span-http',
          ParentSpanId: '',
          ServiceName: 'api-service',
          HyperDXEventType: 'span' as const,
          type: 'trace',
          SpanAttributes: {
            'http.url': 'https://api.example.com/users',
            'http.method': 'GET',
            'http.status_code': 200,
          },
        } as SpanRow,
      ],
      meta: [{ totalCount: 1 }],
    };

    setupQueryMocks({ traceData: mockHttpSpanData });
    renderComponent(null);
    await waitForLoading();

    // Verify the chart received the HTTP span with URL
    expect(MockTimelineChart.latestProps.rows.length).toBe(1);

    expect(MockTimelineChart.latestProps.rows[0]).toBeTruthy();
    expect(
      screen.getByText('http span https://api.example.com/users'),
    ).toBeInTheDocument();
  });

  it('renders Spans and Logs chips when log source is present', async () => {
    setupQueryMocks({ traceData: mockTraceData, logData: mockLogData });
    renderComponent();
    await waitForLoading();

    expect(screen.getByTestId('show-spans-chip')).toBeInTheDocument();
    expect(screen.getByTestId('show-logs-chip')).toBeInTheDocument();
  });

  it('does not render Logs chip when no log source', async () => {
    setupQueryMocks({ traceData: mockTraceData });
    renderComponent(null);
    await waitForLoading();

    expect(screen.getByTestId('show-spans-chip')).toBeInTheDocument();
    expect(screen.queryByTestId('show-logs-chip')).not.toBeInTheDocument();
  });

  it('hides log rows when Logs chip is toggled off', async () => {
    const user = userEvent.setup();
    setupQueryMocks({ traceData: mockTraceData, logData: mockLogData });
    renderComponent();
    await waitForLoading();

    expect(MockTimelineChart.latestProps.rows.length).toBe(2);

    const showLogsChip = screen.getByTestId('show-logs-chip');
    await user.click(showLogsChip);

    await waitFor(() => {
      expect(MockTimelineChart.latestProps.rows.length).toBe(1);
    });
  });

  it('hides span rows when Spans chip is toggled off', async () => {
    const user = userEvent.setup();
    setupQueryMocks({ traceData: mockTraceData, logData: mockLogData });
    renderComponent();
    await waitForLoading();

    expect(MockTimelineChart.latestProps.rows.length).toBe(2);

    const showSpansChip = screen.getByTestId('show-spans-chip');
    await user.click(showSpansChip);

    await waitFor(() => {
      expect(MockTimelineChart.latestProps.rows.length).toBe(1);
    });
  });

  it('renders depth controls when the trace has collapsible spans', async () => {
    // Distinct row ids per span so the parent/child tree is preserved (the
    // default mock collapses every row onto the same id).
    mockUseRowWhere.mockReturnValue((row: any) => ({
      where: `where-${row?.SpanId ?? 'x'}`,
      aliasWith: [],
    }));

    const nestedTraceData = {
      data: [
        {
          Body: 'parent span',
          Timestamp: '2024-01-01T06:00:00.000000000Z',
          Duration: 0.2,
          SpanId: 'span-1',
          ParentSpanId: '',
          ServiceName: 'svc-a',
          HyperDXEventType: 'span' as const,
          type: 'trace',
        } as SpanRow,
        {
          Body: 'child span',
          Timestamp: '2024-01-01T06:00:00.050000000Z',
          Duration: 0.1,
          SpanId: 'span-2',
          ParentSpanId: 'span-1',
          ServiceName: 'svc-b',
          HyperDXEventType: 'span' as const,
          type: 'trace',
        } as SpanRow,
      ],
      meta: [{ totalCount: 2 }],
    };

    setupQueryMocks({ traceData: nestedTraceData });
    renderComponent(null);
    await waitForLoading();

    expect(screen.getByLabelText('Expand all')).toBeInTheDocument();
    expect(screen.getByLabelText('Collapse all')).toBeInTheDocument();
    expect(screen.getByLabelText('Expand one level')).toBeInTheDocument();
    expect(screen.getByLabelText('Collapse one level')).toBeInTheDocument();
  });

  it('does not render depth controls for a flat trace', async () => {
    setupQueryMocks({ traceData: mockTraceData });
    renderComponent(null);
    await waitForLoading();

    expect(screen.queryByLabelText('Expand all')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Collapse all')).not.toBeInTheDocument();
  });

  it('keeps rendering spans when the correlated-log filter errors', async () => {
    // A log filter that references a column the log table lacks is the trigger.
    mockUseWaterfallSearchState.mockReturnValue({
      ...makeWaterfallSearchState(),
      isFilterActive: true,
      isFilterExpanded: true,
      logWhere: "StatusCode = 'Error'",
    });
    setupQueryMocks({
      traceData: mockTraceData,
      logFilterError: new Error('Missing columns: StatusCode'),
    });

    renderComponent(); // with log source
    await waitForLoading();

    // Valid spans still render — the log failure did not blank the chart.
    expect(MockTimelineChart.latestProps.rows.length).toBe(1);
    // The full-chart error block is NOT shown.
    expect(
      screen.queryByText('An error occurred while fetching trace data:'),
    ).not.toBeInTheDocument();
    // The log failure is surfaced inline under the logs filter instead.
    expect(screen.getByTestId('log-filter-error')).toBeInTheDocument();
  });

  it('keeps rendering spans (unfiltered) when the spans filter errors', async () => {
    // A spans filter is a computed column inside the trace query, so an invalid
    // one fails the query. We fall back to unfiltered spans instead of blanking.
    mockUseWaterfallSearchState.mockReturnValue({
      ...makeWaterfallSearchState(),
      isFilterActive: true,
      isFilterExpanded: true,
      traceWhere: "StatusCode = 'Error'",
    });
    setupQueryMocks({
      traceData: mockTraceData,
      traceFilterError: new Error('Missing column: Nope'),
    });

    renderComponent(null); // no log source, to isolate the spans path
    await waitForLoading();

    // Spans still render (unfiltered fallback) — chart is not blanked.
    expect(MockTimelineChart.latestProps.rows.length).toBe(1);
    expect(
      screen.queryByText('An error occurred while fetching trace data:'),
    ).not.toBeInTheDocument();
    // The span filter failure is surfaced inline under the spans filter.
    expect(screen.getByTestId('trace-filter-error')).toBeInTheDocument();
  });

  it('renders the full-chart error block when the base trace query errors', async () => {
    // No filter active, so a trace query error is fatal (nothing to show).
    setupQueryMocks({
      traceError: new Error('Trace query boom'),
      logData: mockLogData,
    });

    renderComponent();

    await waitFor(() => {
      expect(
        screen.getByText('An error occurred while fetching trace data:'),
      ).toBeInTheDocument();
    });
    expect(screen.getByText('Trace query boom')).toBeInTheDocument();
    // The chart itself is replaced by the error block.
    expect(screen.queryByTestId('timeline-chart')).not.toBeInTheDocument();
  });

  it('renders separate span and log filter inputs when a log source exists', async () => {
    mockUseWaterfallSearchState.mockReturnValue({
      ...makeWaterfallSearchState(),
      isFilterExpanded: true,
    });
    setupQueryMocks({ traceData: mockTraceData, logData: mockLogData });

    renderComponent(); // with log source
    await waitForLoading();

    expect(screen.getByTestId('trace-search-input')).toBeInTheDocument();
    expect(screen.getByTestId('log-search-input')).toBeInTheDocument();
  });

  it('renders only the span filter input when there is no log source', async () => {
    mockUseWaterfallSearchState.mockReturnValue({
      ...makeWaterfallSearchState(),
      isFilterExpanded: true,
    });
    setupQueryMocks({ traceData: mockTraceData });

    renderComponent(null); // no log source
    await waitForLoading();

    expect(screen.getByTestId('trace-search-input')).toBeInTheDocument();
    expect(screen.queryByTestId('log-search-input')).not.toBeInTheDocument();
  });
});

describe('useEventsAroundFocus', () => {
  // Test data
  const mockTableSource: TTraceSource = {
    id: 'test-table-source-id',
    kind: SourceKind.Trace,
    name: 'trace-source',
    from: { databaseName: 'test_db', tableName: 'trace_table' },
    timestampValueExpression: 'Timestamp',
    defaultTableSelectExpression: 'Timestamp',
    durationExpression: 'Duration',
    durationPrecision: 9,
    traceIdExpression: 'TraceId',
    spanIdExpression: 'SpanId',
    parentSpanIdExpression: 'ParentSpanId',
    statusCodeExpression: 'StatusCode',
    serviceNameExpression: 'ServiceName',
    spanNameExpression: 'SpanName',
    spanKindExpression: 'SpanKind',
    eventAttributesExpression: 'SpanAttributes',
    implicitColumnExpression: 'Body',
    connection: 'conn1',
  };

  const mockDateRange = [
    new Date('2024-01-01T00:00:00.000Z'),
    new Date('2024-01-01T01:00:00.000Z'),
  ] as [Date, Date];
  const mockFocusDate = new Date('2024-01-01T00:30:00.000Z');
  const mockTraceId = 'test-trace-id';

  beforeEach(() => {
    jest.clearAllMocks();
    mockUseRowWhere.mockReturnValue(() => ({ where: 'row-id', aliasWith: [] }));
  });

  const testEventsAroundFocus = (options: {
    beforeData?: any;
    afterData?: any;
    enabled?: boolean;
  }) => {
    const {
      beforeData = { data: [], meta: [] },
      afterData = { data: [], meta: [] },
      enabled = true,
    } = options;

    mockUseOffsetPaginatedQuery.mockReset();

    if (enabled) {
      mockUseOffsetPaginatedQuery
        .mockReturnValueOnce({ data: beforeData, isFetching: false })
        .mockReturnValueOnce({ data: afterData, isFetching: false });
    } else {
      mockUseOffsetPaginatedQuery.mockReturnValue({
        data: { data: [], meta: [] },
        isFetching: false,
      });
    }

    const { result } = renderHook(() =>
      useEventsAroundFocus({
        tableSource: mockTableSource,
        focusDate: mockFocusDate,
        dateRange: mockDateRange,
        traceId: mockTraceId,
        enabled,
      }),
    );

    return result.current;
  };

  it('fetches events before and after focus date', () => {
    const mockBeforeData = {
      data: [{ Body: 'before focus' }],
      meta: [{ totalCount: 1 }],
    };
    const mockAfterData = {
      data: [{ Body: 'after focus' }],
      meta: [{ totalCount: 1 }],
    };

    const result = testEventsAroundFocus({
      beforeData: mockBeforeData,
      afterData: mockAfterData,
    });

    // Verify queries were called with correct date ranges
    expect(mockUseOffsetPaginatedQuery.mock.calls[0][0].dateRange).toEqual([
      mockDateRange[0],
      mockFocusDate,
    ]);
    expect(mockUseOffsetPaginatedQuery.mock.calls[1][0].dateRange).toEqual([
      mockFocusDate,
      mockDateRange[1],
    ]);

    // Verify results were combined correctly
    expect(result.rows.length).toBe(2);
    expect((result.rows[0] as any).Body).toBe('before focus');
    expect((result.rows[1] as any).Body).toBe('after focus');
  });

  it('handles empty data correctly', () => {
    const result = testEventsAroundFocus({});
    expect(result.rows.length).toBe(0);
  });

  it('does not fetch when disabled', () => {
    const result = testEventsAroundFocus({ enabled: false });
    expect(result.rows.length).toBe(0);
  });
});

describe('getDescendantIds', () => {
  it('returns empty array for node with no children', () => {
    expect(getDescendantIds({ id: 'root' })).toEqual([]);
    expect(getDescendantIds({ id: 'root', children: [] })).toEqual([]);
  });

  it('returns empty array for node with undefined or missing children', () => {
    expect(getDescendantIds({ id: 'root', children: undefined })).toEqual([]);
  });

  it('returns direct children ids for a single level', () => {
    const node = {
      id: 'root',
      children: [
        { id: 'a', children: [] },
        { id: 'b', children: [] },
      ],
    };
    expect(getDescendantIds(node)).toEqual(['a', 'b']);
  });

  it('returns all descendant ids for nested children', () => {
    const node = {
      id: 'root',
      children: [
        {
          id: 'a',
          children: [
            { id: 'a1', children: [] },
            { id: 'a2', children: [] },
          ],
        },
        { id: 'b', children: [] },
      ],
    };
    expect(getDescendantIds(node)).toEqual(['a', 'a1', 'a2', 'b']);
  });

  it('skips children without id but still recurses into their descendants', () => {
    const node = {
      id: 'root',
      children: [
        {
          children: [{ id: 'grandchild', children: [] }],
        },
      ],
    };
    expect(getDescendantIds(node)).toEqual(['grandchild']);
  });

  it('returns single descendant for one child', () => {
    const node = {
      id: 'root',
      children: [{ id: 'only', children: [] }],
    };
    expect(getDescendantIds(node)).toEqual(['only']);
  });
});

describe('depth control helpers', () => {
  // Build a level -> parent-ids map. Keys are intentionally passed out of order
  // in some tests to prove the helpers sort levels themselves.
  const makeLevels = (entries: Array<[number, string[]]>) =>
    new Map<number, Set<string>>(
      entries.map(([level, ids]) => [level, new Set(ids)]),
    );

  // A 3-deep tree of collapsible parents:
  //   level 0: root
  //   level 1: a, b
  //   level 2: a1
  const threeLevels = () =>
    makeLevels([
      [2, ['a1']],
      [0, ['root']],
      [1, ['a', 'b']],
    ]);

  const asSorted = (set: Set<string>) => [...set].sort();

  describe('computeCollapseAll', () => {
    it('returns an empty set for a trace with no collapsible parents', () => {
      expect(computeCollapseAll(new Map())).toEqual(new Set());
    });

    it('flattens every parent id from every level into one set', () => {
      expect(asSorted(computeCollapseAll(threeLevels()))).toEqual([
        'a',
        'a1',
        'b',
        'root',
      ]);
    });
  });

  describe('computeExpandOneLevel', () => {
    it('returns the same set reference when nothing is collapsed', () => {
      const collapsed = new Set<string>();
      const result = computeExpandOneLevel(collapsed, threeLevels());
      // Identity is relied on by the caller to skip a redundant state update.
      expect(result).toBe(collapsed);
    });

    it('expands the shallowest collapsed level first', () => {
      const levels = threeLevels();
      const fullyCollapsed = new Set(['root', 'a', 'b', 'a1']);

      // level 0 (root) is shallowest -> expanded first.
      const afterOne = computeExpandOneLevel(fullyCollapsed, levels);
      expect(asSorted(afterOne)).toEqual(['a', 'a1', 'b']);

      // next shallowest collapsed level is level 1 (a, b).
      const afterTwo = computeExpandOneLevel(afterOne, levels);
      expect(asSorted(afterTwo)).toEqual(['a1']);

      // finally level 2 (a1).
      const afterThree = computeExpandOneLevel(afterTwo, levels);
      expect(asSorted(afterThree)).toEqual([]);
    });

    it('skips already-expanded shallow levels', () => {
      // Only the deepest level remains collapsed.
      const result = computeExpandOneLevel(new Set(['a1']), threeLevels());
      expect(asSorted(result)).toEqual([]);
    });

    it('does not mutate the input set', () => {
      const collapsed = new Set(['root', 'a', 'b', 'a1']);
      computeExpandOneLevel(collapsed, threeLevels());
      expect(asSorted(collapsed)).toEqual(['a', 'a1', 'b', 'root']);
    });
  });

  describe('computeCollapseOneLevel', () => {
    it('collapses the deepest expanded level first', () => {
      const levels = threeLevels();

      // Nothing collapsed -> deepest level (a1) collapses first.
      const afterOne = computeCollapseOneLevel(new Set<string>(), levels);
      expect(asSorted(afterOne)).toEqual(['a1']);

      // next deepest expanded level is level 1 (a, b).
      const afterTwo = computeCollapseOneLevel(afterOne, levels);
      expect(asSorted(afterTwo)).toEqual(['a', 'a1', 'b']);

      // finally level 0 (root).
      const afterThree = computeCollapseOneLevel(afterTwo, levels);
      expect(asSorted(afterThree)).toEqual(['a', 'a1', 'b', 'root']);
    });

    it('skips already-collapsed deep levels', () => {
      // Deepest level already collapsed -> collapse level 1 next.
      const result = computeCollapseOneLevel(new Set(['a1']), threeLevels());
      expect(asSorted(result)).toEqual(['a', 'a1', 'b']);
    });

    it('returns an equivalent set when everything is already collapsed', () => {
      const fullyCollapsed = new Set(['root', 'a', 'b', 'a1']);
      const result = computeCollapseOneLevel(fullyCollapsed, threeLevels());
      expect(asSorted(result)).toEqual(['a', 'a1', 'b', 'root']);
    });

    it('does not mutate the input set', () => {
      const collapsed = new Set(['a1']);
      computeCollapseOneLevel(collapsed, threeLevels());
      expect(asSorted(collapsed)).toEqual(['a1']);
    });
  });

  it('expand and collapse one level are inverse across a full tree', () => {
    const levels = threeLevels();

    // Collapse everything one level at a time.
    let state = new Set<string>();
    state = computeCollapseOneLevel(state, levels); // a1
    state = computeCollapseOneLevel(state, levels); // + a, b
    state = computeCollapseOneLevel(state, levels); // + root
    expect(asSorted(state)).toEqual(['a', 'a1', 'b', 'root']);

    // Expand everything one level at a time back to empty.
    state = computeExpandOneLevel(state, levels); // - root
    state = computeExpandOneLevel(state, levels); // - a, b
    state = computeExpandOneLevel(state, levels); // - a1
    expect(asSorted(state)).toEqual([]);
  });

  describe('computeToggleCollapse', () => {
    // A parent `p` with a nested subtree: descendants are c1, c1a, c2.
    const node = () => ({
      id: 'p',
      children: [
        { id: 'c1', children: [{ id: 'c1a', children: [] }] },
        { id: 'c2', children: [] },
      ],
    });

    it('collapses an expanded node (adds its id)', () => {
      expect(
        asSorted(computeToggleCollapse(new Set(), 'p', node(), false)),
      ).toEqual(['p']);
    });

    it('expands a collapsed node (removes its id)', () => {
      expect(
        asSorted(computeToggleCollapse(new Set(['p']), 'p', node(), false)),
      ).toEqual([]);
    });

    it('collapses the whole subtree when includeDescendants is true', () => {
      expect(
        asSorted(computeToggleCollapse(new Set(), 'p', node(), true)),
      ).toEqual(['c1', 'c1a', 'c2', 'p']);
    });

    it('expands the whole subtree when includeDescendants is true', () => {
      const collapsed = new Set(['p', 'c1', 'c1a', 'c2']);
      expect(
        asSorted(computeToggleCollapse(collapsed, 'p', node(), true)),
      ).toEqual([]);
    });

    it('leaves descendants untouched when includeDescendants is false', () => {
      // c1 stays collapsed even though the parent is toggled.
      expect(
        asSorted(computeToggleCollapse(new Set(['c1']), 'p', node(), false)),
      ).toEqual(['c1', 'p']);
    });

    it('toggles only the id when the node is not found', () => {
      expect(
        asSorted(computeToggleCollapse(new Set(), 'missing', undefined, true)),
      ).toEqual(['missing']);
    });

    it('toggles only the id for a leaf node with no children', () => {
      const leaf = { id: 'leaf', children: [] };
      expect(
        asSorted(computeToggleCollapse(new Set(), 'leaf', leaf, true)),
      ).toEqual(['leaf']);
    });

    it('does not mutate the input set', () => {
      const collapsed = new Set(['other']);
      computeToggleCollapse(collapsed, 'p', node(), true);
      expect(asSorted(collapsed)).toEqual(['other']);
    });
  });
});
