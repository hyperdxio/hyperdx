import {
  SourceKind,
  TLogSource,
  TTraceSource,
} from '@hyperdx/common-utils/dist/types';
import { renderHook } from '@testing-library/react';

import {
  useLogEventRows,
  useSessionLogEvents,
} from '@/hooks/useSessionLogEvents';
import type { SessionIdKey } from '@/utils/sessionId';

const mockUseSource = jest.fn();
const mockUseQueriedChartConfig = jest.fn();
const mockUseFieldExpressionGenerator = jest.fn();

jest.mock('@/source', () => ({
  ...jest.requireActual('@/source'),
  useSource: (args: unknown) => mockUseSource(args),
}));
jest.mock('@/hooks/useChartConfig', () => ({
  useQueriedChartConfig: (...args: unknown[]) =>
    mockUseQueriedChartConfig(...args),
}));
jest.mock('@/hooks/useFieldExpressionGenerator', () => ({
  __esModule: true,
  default: (source?: TLogSource) => {
    mockUseFieldExpressionGenerator(source);
    return {
      isLoading: false,
      getFieldExpression: source
        ? (column: string, key: string) => `${column}['${key}']`
        : undefined,
    };
  },
}));
jest.mock('@/useFormatTime', () => ({
  useFormatTime: () => (ts: number) => `t${ts}`,
}));

const traceSource: TTraceSource = {
  id: 'traces',
  kind: SourceKind.Trace,
  name: 'Traces',
  connection: 'conn',
  from: { databaseName: 'default', tableName: 'otel_traces' },
  timestampValueExpression: 'Timestamp',
  defaultTableSelectExpression: 'Timestamp, SpanName',
  durationExpression: 'Duration',
  durationPrecision: 9,
  traceIdExpression: 'TraceId',
  spanIdExpression: 'SpanId',
  parentSpanIdExpression: 'ParentSpanId',
  spanNameExpression: 'SpanName',
  spanKindExpression: 'SpanKind',
  logSourceId: 'logs',
};
const logSource: TLogSource = {
  id: 'logs',
  kind: SourceKind.Log,
  name: 'Logs',
  connection: 'conn',
  from: { databaseName: 'default', tableName: 'otel_logs' },
  timestampValueExpression: 'TimestampTime',
  displayedTimestampValueExpression: 'Timestamp',
  defaultTableSelectExpression: 'Timestamp, Body',
  implicitColumnExpression: 'Body',
  eventAttributesExpression: 'LogAttributes',
  eventNameExpression: 'EventName',
};

const TIMESTAMP = '2026-10-22T02:17:49.873000000Z';
const queryResult = {
  data: [
    {
      timestamp: TIMESTAMP,
      timestamp_key: '2026-10-22T02:17:49Z',
      event_name: 'browser.user_action.click',
      session_id: 's1',
      body: '',
      attributes: { 'browser.tag_name': 'BUTTON' },
    },
  ],
  meta: [
    { name: 'timestamp', type: 'DateTime64(9)' },
    { name: 'timestamp_key', type: 'DateTime' },
    { name: 'event_name', type: 'String' },
    { name: 'session_id', type: 'String' },
    { name: 'body', type: 'String' },
    { name: 'attributes', type: 'Map(LowCardinality(String), String)' },
  ],
};

function renderLogEvents(sessionIdKey: SessionIdKey, searchedQuery = '') {
  const onEventNavigate = jest.fn();
  const dateRange: [Date, Date] = [new Date(0), new Date(1)];
  const hook = renderHook(() =>
    useSessionLogEvents({
      traceSource,
      sessionId: 's1',
      sessionIdKey,
      serviceName: 'web',
      dateRange,
      tab: 'events',
      searchedQuery,
      onEventNavigate,
    }),
  );
  return { ...hook, onEventNavigate };
}

describe('useSessionLogEvents', () => {
  beforeEach(() => {
    mockUseSource.mockImplementation(({ id }: { id: string | null }) => ({
      data: id === 'logs' ? logSource : undefined,
      isLoading: false,
    }));
    mockUseQueriedChartConfig.mockImplementation(
      (_config: unknown, { enabled }: { enabled: boolean }) => ({
        data: enabled ? queryResult : undefined,
        isLoading: false,
        isError: false,
      }),
    );
  });

  it('sends nothing for a legacy session', () => {
    const { result, rerender } = renderLogEvents('rum.sessionId');
    const { events } = result.current;
    rerender();

    expect(mockUseSource).toHaveBeenCalledWith(
      expect.objectContaining({ id: null }),
    );
    expect(mockUseQueriedChartConfig).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.objectContaining({ enabled: false }),
    );
    expect(result.current.isLoading).toBe(false);
    expect(result.current.events).toHaveLength(0);
    expect(result.current.events).toBe(events);
  });

  it('skips the metadata lookup while a search is active', () => {
    const { result } = renderLogEvents('session.id', 'SpanName:foo');

    expect(mockUseFieldExpressionGenerator).toHaveBeenLastCalledWith(undefined);
    expect(mockUseQueriedChartConfig).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.objectContaining({ enabled: false }),
    );
    expect(result.current.isLoading).toBe(false);
  });

  it('hides log events when the query fails', () => {
    mockUseQueriedChartConfig.mockReturnValue({
      data: queryResult,
      isLoading: false,
      isError: true,
    });
    const { result } = renderLogEvents('session.id');

    expect(result.current.events).toHaveLength(0);
    expect(result.current.isLoading).toBe(false);
  });

  it('opens an event on the log source by its key columns', () => {
    const { result, onEventNavigate } = renderLogEvents('session.id');

    expect(result.current.events[0].title).toBe('Clicked button');
    result.current.open(result.current.events[0]);

    expect(onEventNavigate).toHaveBeenCalledWith(
      `Timestamp=parseDateTime64BestEffort('${TIMESTAMP}', 9) AND TimestampTime=parseDateTime64BestEffort('2026-10-22T02:17:49Z', 9) AND toString(EventName)='browser.user_action.click' AND LogAttributes['session.id']='s1' AND Body=''`,
      [],
      { sourceId: 'logs', focusTimestamp: '2026-10-22T02:17:49.873Z' },
    );
  });
});

describe('useLogEventRows', () => {
  it('merges log events into span rows by time, log events first on ties', () => {
    const spanRows = [
      { id: 'a', timestamp: new Date(1000) },
      { id: 'b', timestamp: new Date(3000) },
    ];
    const noLogs = { events: [], isLoading: false, open: jest.fn() };
    const logs = {
      ...noLogs,
      events: [1000, 2000].map(ts => ({
        id: `log-${ts}`,
        timestamp: new Date(ts),
        title: 'Clicked button',
        description: '',
        timelineText: '',
        isError: false,
        eventSource: 'custom' as const,
        row: {},
      })),
    };

    expect(
      renderHook(() => useLogEventRows(spanRows, noLogs, false, 0)).result
        .current,
    ).toBe(spanRows);
    expect(
      renderHook(() =>
        useLogEventRows(spanRows, logs, false, 0),
      ).result.current.map(row => row.id),
    ).toEqual(['log-1000', 'a', 'log-2000', 'b']);
  });
});
