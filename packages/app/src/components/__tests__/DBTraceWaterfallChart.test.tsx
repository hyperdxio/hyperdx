import React from 'react';
import { SourceKind, TSource } from '@hyperdx/common-utils/dist/types';
import { render, screen, waitFor } from '@testing-library/react';
import { renderHook } from '@testing-library/react-hooks';

import useOffsetPaginatedQuery from '@/hooks/useOffsetPaginatedQuery';
import useRowWhere from '@/hooks/useRowWhere';
import TimelineChart from '@/TimelineChart';

import {
  DBTraceWaterfallChartContainer,
  SpanRow,
  useEventsAroundFocus,
} from '../DBTraceWaterfallChart';

// Mock setup
jest.mock('@/TimelineChart', () => {
  const mockComponent = function MockTimelineChart(props: any) {
    mockComponent.latestProps = props;
    return <div data-testid="timeline-chart">TimelineChart</div>;
  };
  mockComponent.latestProps = {};
  return mockComponent;
});

jest.mock('@/hooks/useOffsetPaginatedQuery');
jest.mock('@/hooks/useRowWhere');

const mockUseOffsetPaginatedQuery = useOffsetPaginatedQuery as jest.Mock;
const mockUseRowWhere = useRowWhere as jest.Mock;
const MockTimelineChart = TimelineChart as any;

describe('DBTraceWaterfallChartContainer', () => {
  // Common test data
  const mockTraceTableSource: TSource = {
    id: 'trace-source-id',
    kind: SourceKind.Trace,
    name: 'trace-source',
    from: { databaseName: 'test_db', tableName: 'trace_table' },
    timestampValueExpression: 'Timestamp',
    durationExpression: 'Duration',
    traceIdExpression: 'TraceId',
    spanIdExpression: 'SpanId',
    parentSpanIdExpression: 'ParentSpanId',
    statusCodeExpression: 'StatusCode',
    serviceNameExpression: 'ServiceName',
    severityTextExpression: 'SeverityText',
    eventAttributesExpression: 'SpanAttributes',
    implicitColumnExpression: 'Body',
    connection: 'conn1',
  };

  const mockLogTableSource: TSource = {
    id: 'log-source-id',
    kind: SourceKind.Log,
    name: 'log-source',
    from: { databaseName: 'test_db', tableName: 'log_table' },
    timestampValueExpression: 'Timestamp',
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
        Timestamp: '1704088800000000000',
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
        Timestamp: '1704088800000000000',
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
    mockUseRowWhere.mockReturnValue(() => 'row-id');
    MockTimelineChart.latestProps = {};
  });

  // Helper functions
  const renderComponent = (
    logTableSource: typeof mockLogTableSource | null = mockLogTableSource,
  ) => {
    return render(
      <DBTraceWaterfallChartContainer
        traceTableSource={mockTraceTableSource}
        logTableSource={logTableSource}
        traceId={mockTraceId}
        dateRange={mockDateRange}
        focusDate={mockFocusDate}
      />,
    );
  };

  const waitForLoading = async () => {
    await waitFor(() => {
      expect(screen.getByTestId('timeline-chart')).toBeInTheDocument();
    });
  };

  const setupQueryMocks = (options: {
    traceData?: typeof mockTraceData | typeof emptyData;
    logData?: typeof mockLogData | typeof emptyData;
    isFetching?: boolean;
  }) => {
    const {
      traceData = emptyData,
      logData = emptyData,
      isFetching = false,
    } = options;

    mockUseOffsetPaginatedQuery.mockReset();

    // Mock all four query calls in sequence (trace before/after, log before/after)
    mockUseOffsetPaginatedQuery
      .mockReturnValueOnce({ data: traceData, isFetching }) // trace before
      .mockReturnValueOnce({ data: emptyData, isFetching }) // trace after
      .mockReturnValueOnce({ data: logData, isFetching }) // log before
      .mockReturnValueOnce({ data: emptyData, isFetching }); // log after
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

  it('renders correctly with empty data', async () => {
    mockUseOffsetPaginatedQuery.mockReturnValue({
      data: emptyData,
      isFetching: false,
    });

    renderComponent();
    await waitForLoading();

    // Verify empty rows are passed to the chart
    expect(MockTimelineChart.latestProps.rows.length).toBe(0);
  });

  it('renders HTTP spans with URL information', async () => {
    // HTTP span with URL and method information
    const mockHttpSpanData = {
      data: [
        {
          Body: 'http span',
          Timestamp: '1704088800000000000',
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

    const row = MockTimelineChart.latestProps.rows[0];
    expect(row).toBeTruthy();

    // Check the display text includes the URL
    expect(row.events[0].body.props.children).toBe(
      'http span https://api.example.com/users',
    );
  });
});

describe('useEventsAroundFocus', () => {
  // Test data
  const mockTableSource: TSource = {
    id: 'test-table-source-id',
    kind: SourceKind.Trace,
    name: 'trace-source',
    from: { databaseName: 'test_db', tableName: 'trace_table' },
    timestampValueExpression: 'Timestamp',
    durationExpression: 'Duration',
    traceIdExpression: 'TraceId',
    spanIdExpression: 'SpanId',
    parentSpanIdExpression: 'ParentSpanId',
    statusCodeExpression: 'StatusCode',
    serviceNameExpression: 'ServiceName',
    severityTextExpression: 'SeverityText',
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
    mockUseRowWhere.mockReturnValue(() => 'row-id');
  });

  it('fetches events before and after focus date', async () => {
    // Mock data for before and after the focus date
    const mockBeforeData = {
      data: [{ Body: 'before focus' }],
      meta: [{ totalCount: 1 }],
    };
    const mockAfterData = {
      data: [{ Body: 'after focus' }],
      meta: [{ totalCount: 1 }],
    };

    // Set up mock return values for the two queries
    mockUseOffsetPaginatedQuery
      .mockReturnValueOnce({ data: mockBeforeData, isFetching: false }) // before focus
      .mockReturnValueOnce({ data: mockAfterData, isFetching: false }); // after focus

    // Render the hook
    const { result, waitForNextUpdate } = renderHook(() =>
      useEventsAroundFocus({
        tableSource: mockTableSource,
        focusDate: mockFocusDate,
        dateRange: mockDateRange,
        traceId: mockTraceId,
        enabled: true,
      }),
    );

    await waitForNextUpdate();

    // Verify queries were called with correct date ranges
    expect(mockUseOffsetPaginatedQuery).toHaveBeenCalledTimes(2);
    expect(mockUseOffsetPaginatedQuery.mock.calls[0][0].dateRange).toEqual([
      mockDateRange[0],
      mockFocusDate,
    ]);
    expect(mockUseOffsetPaginatedQuery.mock.calls[1][0].dateRange).toEqual([
      mockFocusDate,
      mockDateRange[1],
    ]);

    // Verify results were combined correctly
    expect(result.current.rows.length).toBe(2);
    expect((result.current.rows[0] as any).Body).toBe('before focus');
    expect((result.current.rows[1] as any).Body).toBe('after focus');
  });

  it('handles empty data correctly', async () => {
    // Mock empty data response
    mockUseOffsetPaginatedQuery.mockReturnValue({
      data: { data: [], meta: [] },
      isFetching: false,
    });

    // Render the hook
    const { result, waitForNextUpdate } = renderHook(() =>
      useEventsAroundFocus({
        tableSource: mockTableSource,
        focusDate: mockFocusDate,
        dateRange: mockDateRange,
        traceId: mockTraceId,
        enabled: true,
      }),
    );

    await waitForNextUpdate();

    // Verify empty results
    expect(result.current.rows.length).toBe(0);
  });
});
