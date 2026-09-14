import React from 'react';
import { TSource } from '@hyperdx/common-utils/dist/types';
import { MantineProvider } from '@mantine/core';
import { act, render } from '@testing-library/react';

// In-memory nuqs so the active tab can be seeded and the stack setters
// inspected. Prefixed with `mock` so jest.mock factories may reference them.
const mockQueryStore: Record<string, unknown> = {};
const mockSetters: Record<string, jest.Mock> = {};

function setterFor(key: string) {
  if (!mockSetters[key]) mockSetters[key] = jest.fn();
  return mockSetters[key];
}
function resetQueryState() {
  Object.keys(mockQueryStore).forEach(k => delete mockQueryStore[k]);
  Object.keys(mockSetters).forEach(k => delete mockSetters[k]);
}

jest.mock('nuqs', () => {
  const actual = jest.requireActual('nuqs');
  return {
    ...actual,
    useQueryState: (key: string, parser?: { defaultValue?: unknown }) => {
      const hasValue = Object.prototype.hasOwnProperty.call(
        mockQueryStore,
        key,
      );
      const fallback =
        parser && 'defaultValue' in parser ? parser.defaultValue : null;
      const value = hasValue ? mockQueryStore[key] : (fallback ?? null);
      if (!mockSetters[key]) mockSetters[key] = jest.fn();
      return [value, mockSetters[key]];
    },
  };
});

const mockUseRowData = jest.fn();
jest.mock('../DBRowDataPanel', () => ({
  __esModule: true,
  useRowData: (args: unknown) => mockUseRowData(args),
  ROW_DATA_ALIASES: {
    TIMESTAMP: '__hdx_timestamp',
    DURATION_MS: '__hdx_duration',
    SPAN_KIND: '__hdx_span_kind',
    SERVICE_NAME: '__hdx_service_name',
    SEVERITY_TEXT: '__hdx_severity_text',
  },
  rowHasK8sContext: () => false,
  RowDataPanel: () => null,
  getJSONColumnNames: () => [],
  getMapColumnNames: () => [],
}));

const TRACE_SOURCE_WITH_LOGS = {
  id: 'trace-src',
  kind: 'trace',
  traceIdExpression: 'TraceId',
  spanIdExpression: 'SpanId',
  logSourceId: 'log-src',
  timestampValueExpression: 'Timestamp',
  resourceAttributesExpression: 'ResourceAttributes',
};

const LOG_SOURCE = {
  id: 'log-src',
  kind: 'log',
  traceSourceId: 'trace-src',
  traceIdExpression: 'TraceId',
  timestampValueExpression: 'Timestamp',
  resourceAttributesExpression: 'ResourceAttributes',
};

jest.mock('@/source', () => ({
  __esModule: true,
  getEventBody: () => '__hdx_body',
  useSource: ({ id }: { id: string | null }) =>
    id === 'trace-src'
      ? { data: TRACE_SOURCE_WITH_LOGS }
      : id === 'log-src'
        ? { data: LOG_SOURCE }
        : { data: undefined },
}));

type TabBarProps = {
  items?: { text: string; value: string }[];
  activeItem?: unknown;
  onClick?: (v: unknown) => void;
};
const mockTabBarProps: { current: TabBarProps } = { current: {} };
jest.mock('@/TabBar', () => ({
  __esModule: true,
  default: (props: TabBarProps) => {
    mockTabBarProps.current = props;
    return null;
  },
}));

type TraceLogsPanelProps = {
  logSourceId?: string;
  traceId?: string;
  highlightedRowId?: string;
  onNavigateToLog?: (
    rowId: string,
    aliasWith: unknown[],
    label: string,
  ) => void;
};
const mockTraceLogsProps: { current: TraceLogsPanelProps } = { current: {} };
jest.mock('../TraceLogsPanel', () => ({
  __esModule: true,
  default: (props: TraceLogsPanelProps) => {
    mockTraceLogsProps.current = props;
    return null;
  },
}));

jest.mock('../DBSessionPanel', () => ({
  __esModule: true,
  useSessionId: () => ({ rumSessionId: undefined, rumServiceName: undefined }),
  DBSessionPanel: () => null,
}));
jest.mock('@/utils/highlightedAttributes', () => ({
  __esModule: true,
  getHighlightedAttributesFromData: () => [],
}));
jest.mock('../DBTracePanel', () => ({ __esModule: true, default: () => null }));
jest.mock('../ContextSidePanel', () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock('../DBInfraPanel', () => ({ __esModule: true, default: () => null }));
jest.mock('../DBRowOverviewPanel', () => ({
  __esModule: true,
  RowOverviewPanel: () => null,
}));
jest.mock('../DBRowSidePanelErrorState', () => ({
  __esModule: true,
  DBRowSidePanelErrorState: () => null,
}));
jest.mock('../DBRowSidePanelHeader', () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock('../SidePanelBreadcrumbs', () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock('../LogLevel', () => ({ __esModule: true, default: () => null }));
jest.mock('../ServiceMap/ServiceMapSidePanel', () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock('../TimelineChart/utils', () => ({
  __esModule: true,
  renderMs: () => '',
}));
jest.mock('../DrawerUtils', () => ({
  __esModule: true,
  DrawerFullWidthToggle: () => null,
  INITIAL_DRAWER_WIDTH_PERCENT: 50,
}));
jest.mock('@/LogSidePanelElements', () => ({
  __esModule: true,
  KeyboardShortcutsModal: () => null,
}));
jest.mock('@/useFormatTime', () => ({
  __esModule: true,
  FormatTime: () => null,
}));

// NOTE: imported after the mock factories above.
import { DBRowSidePanelInner } from '@/components/DBRowSidePanel';
import { Tab } from '@/components/DBRowSidePanel.types';
import useSidePanelStack from '@/hooks/useSidePanelStack';

const TRACE_ID = '7316d5a2ab0dc2efa72258f64a98a405';
const SPAN_ID = 'e3748131832d6176';
const TIMESTAMP_VALUE = '2024-05-01T10:00:00.123456789Z';

function rowResult(row: Record<string, unknown>) {
  return {
    data: {
      data: [row],
      meta: [{ name: '__hdx_timestamp_value_0', type: 'DateTime64(9)' }],
    },
    isLoading: false,
    isSuccess: true,
    isError: false,
    error: null,
  };
}

const ROW_WITH_TRACE = {
  __hdx_trace_id: TRACE_ID,
  __hdx_span_id: SPAN_ID,
  __hdx_timestamp: TIMESTAMP_VALUE,
  __hdx_timestamp_value_0: TIMESTAMP_VALUE,
  __hdx_body: 'a log line',
};

function renderPanel(source: TSource, rowId = 'row-1') {
  function Harness() {
    const sidePanelStack = useSidePanelStack({ initialRowId: rowId });
    return (
      <DBRowSidePanelInner
        source={source}
        rowId={rowId}
        aliasWith={[]}
        onClose={jest.fn()}
        sidePanelStack={sidePanelStack}
      />
    );
  }
  return render(
    <MantineProvider>
      <Harness />
    </MantineProvider>,
  );
}

function tabValues() {
  return (mockTabBarProps.current.items ?? []).map(item => item.value);
}

function clickLogRow(rowId: string, label = 'another log line') {
  act(() => mockTraceLogsProps.current.onNavigateToLog?.(rowId, [], label));
}

describe('DBRowSidePanelInner — trace logs tab', () => {
  beforeEach(() => {
    resetQueryState();
    localStorage.clear();
    mockTabBarProps.current = {};
    mockTraceLogsProps.current = {};
    mockUseRowData.mockReset();
    mockUseRowData.mockReturnValue(rowResult(ROW_WITH_TRACE));
  });

  it('offers the tab on a span, pointed at the correlated log source', () => {
    mockQueryStore.sidePanelTab = Tab.Logs;
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    renderPanel(TRACE_SOURCE_WITH_LOGS as TSource);

    expect(tabValues()).toContain(Tab.Logs);
    expect(mockTraceLogsProps.current.logSourceId).toBe('log-src');
    expect(mockTraceLogsProps.current.traceId).toBe(TRACE_ID);
    // Nothing to highlight: the row on screen is a span, not one of these logs.
    expect(mockTraceLogsProps.current.highlightedRowId).toBeUndefined();
  });

  it('offers the tab on a log, pointed at its own source and highlighting it', () => {
    mockQueryStore.sidePanelTab = Tab.Logs;
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    renderPanel(LOG_SOURCE as TSource);

    expect(tabValues()).toContain(Tab.Logs);
    expect(mockTraceLogsProps.current.logSourceId).toBe('log-src');
    expect(mockTraceLogsProps.current.highlightedRowId).toBe('row-1');
  });

  it('hides the tab when the trace source has no correlated log source', () => {
    const traceSourceWithoutLogs = {
      ...TRACE_SOURCE_WITH_LOGS,
      logSourceId: undefined,
    };
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    renderPanel(traceSourceWithoutLogs as TSource);

    expect(tabValues()).not.toContain(Tab.Logs);
  });

  it('hides the tab when the row carries no trace id', () => {
    mockUseRowData.mockReturnValue(
      rowResult({ ...ROW_WITH_TRACE, __hdx_trace_id: '' }),
    );
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    renderPanel(LOG_SOURCE as TSource);

    expect(tabValues()).not.toContain(Tab.Logs);
  });

  it('pushes a cross-source frame when a log is picked from a span', () => {
    mockQueryStore.sidePanelTab = Tab.Logs;
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    renderPanel(TRACE_SOURCE_WITH_LOGS as TSource);

    clickLogRow("TraceId='abc' AND SpanId='def'");

    const frame = setterFor('sidePanelSourceStack').mock.calls[0][0][0];
    expect(frame).toMatchObject({
      sourceId: 'log-src',
      rowId: "TraceId='abc' AND SpanId='def'",
      label: 'another log line',
      sourceKind: 'log',
      // Anchors the destination's row lookup: every log in a trace sits within
      // seconds of the span we came from.
      focusTimestamp: new Date(TIMESTAMP_VALUE).toISOString(),
    });
    // A source hop resets the same-source drilldown trail rather than adding
    // to it.
    expect(setterFor('sidePanelNavStack')).toHaveBeenCalledWith([]);
  });

  it('stays in the same source when a log is picked from another log', () => {
    mockQueryStore.sidePanelTab = Tab.Logs;
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    renderPanel(LOG_SOURCE as TSource);

    clickLogRow('row-2');

    expect(setterFor('sidePanelNavStack').mock.calls[0][0][0]).toMatchObject({
      rowId: 'row-2',
      label: 'another log line',
      sourceKind: 'log',
    });
    // No source hop: the cross-source trail is rewritten unchanged (empty).
    expect(setterFor('sidePanelSourceStack')).toHaveBeenCalledWith([]);
  });

  it('lands the picked log on a reading view, not on another logs list', () => {
    mockQueryStore.sidePanelTab = Tab.Logs;
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    renderPanel(LOG_SOURCE as TSource);

    clickLogRow('row-2');

    expect(setterFor('sidePanelTab')).toHaveBeenCalledWith(Tab.Overview);
  });
});
