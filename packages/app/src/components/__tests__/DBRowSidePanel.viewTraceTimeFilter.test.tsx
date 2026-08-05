import React from 'react';
import { TSource } from '@hyperdx/common-utils/dist/types';
import { MantineProvider } from '@mantine/core';
import { fireEvent, render, screen } from '@testing-library/react';

// Controlled, in-memory replacement for nuqs' useQueryState so each side-panel
// URL param can be seeded and its setter inspected independently. Values are
// the already-parsed shapes the component consumes (arrays / strings), not URL
// strings. Prefixed with `mock` so jest.mock's factory may reference them.
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
const mockRowDataPanel = jest.fn();
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
  RowDataPanel: (props: unknown) => {
    mockRowDataPanel(props);
    return null;
  },
  getJSONColumnNames: () => [],
  getMapColumnNames: () => [],
}));

const mockRowOverviewPanel = jest.fn();
jest.mock('../DBRowOverviewPanel', () => ({
  __esModule: true,
  RowOverviewPanel: (props: unknown) => {
    mockRowOverviewPanel(props);
    return null;
  },
}));

const TRACE_SOURCE = {
  id: 'trace-src',
  kind: 'trace',
  traceIdExpression: 'TraceId',
  spanIdExpression: 'SpanId',
  // Makes hasOverviewPanel true, so the landed frame can render the Overview tab.
  resourceAttributesExpression: 'ResourceAttributes',
};

// A second log source, used as a cross-source destination whose default tab is
// Overview (a trace destination lands on the Trace tab instead, which renders
// the row detail from inside the waterfall).
const LOG_DEST_SOURCE = {
  id: 'log-dest',
  kind: 'log',
  resourceAttributesExpression: 'ResourceAttributes',
};

jest.mock('@/source', () => ({
  __esModule: true,
  getEventBody: () => undefined,
  useSource: ({ id }: { id: string | null }) =>
    id === 'trace-src'
      ? { data: TRACE_SOURCE }
      : id === 'log-dest'
        ? { data: LOG_DEST_SOURCE }
        : { data: undefined },
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

// Heavy leaf components / chart deps the panel imports but never renders for
// this row shape.
jest.mock('../DBTracePanel', () => ({ __esModule: true, default: () => null }));
jest.mock('../ContextSidePanel', () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock('../DBInfraPanel', () => ({ __esModule: true, default: () => null }));
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
jest.mock('@/TabBar', () => ({ __esModule: true, default: () => null }));
jest.mock('@/useFormatTime', () => ({
  __esModule: true,
  FormatTime: () => null,
}));

// NOTE: this import is intentionally placed after the mock factories above,
// which close over the `mock*` helpers declared at the top of this file.
import { DBRowSidePanelInner } from '@/components/DBRowSidePanel';
import useSidePanelStack from '@/hooks/useSidePanelStack';
import { getRowLookupWindow } from '@/utils/rowTimestamps';

// eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
const ROOT_SOURCE = {
  id: 'log-src',
  kind: 'log',
  traceSourceId: 'trace-src',
  timestampValueExpression: 'Timestamp',
  resourceAttributesExpression: 'ResourceAttributes',
} as TSource;

const TRACE_ID = '7316d5a2ab0dc2efa72258f64a98a405';
const SPAN_ID = 'e3748131832d6176';
const TRACE_SPAN_ROW_ID = `TraceId='${TRACE_ID}' AND SpanId='${SPAN_ID}'`;

// The source's `timestampValueExpression` value, deliberately different from the
// displayed timestamp so a test can tell which one the window is anchored to.
const TIMESTAMP_VALUE = '2024-05-01T10:00:00.123456789Z';
const DISPLAYED_TIMESTAMP = '2024-05-01T22:00:00.000000000Z';

function rowResult({
  row,
  meta,
}: {
  row: Record<string, unknown>;
  meta: { name: string; type: string }[];
}) {
  return {
    data: { data: [row], meta },
    isLoading: false,
    isSuccess: true,
    isError: false,
    error: null,
  };
}

function InnerHarness({
  rowId,
  source = ROOT_SOURCE,
}: {
  rowId: string;
  source?: TSource;
}) {
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

function renderInner(rowId: string, source?: TSource) {
  return render(
    <MantineProvider>
      <InnerHarness rowId={rowId} source={source} />
    </MantineProvider>,
  );
}

/** Args of the last useRowData call, i.e. the one the render settled on. */
function lastRowDataArgs() {
  const { calls } = mockUseRowData.mock;
  return calls[calls.length - 1][0];
}

function pushedFrame() {
  return setterFor('sidePanelSourceStack').mock.calls[0][0][0];
}

/**
 * Delegates to the real helper: these tests assert the window reaches the
 * lookup, while its bounds are pinned in `utils/__tests__/rowTimestamps.test.ts`.
 */
function lookupWindow(isoTimestamp: string) {
  return getRowLookupWindow(isoTimestamp);
}

describe('DBRowSidePanelInner, "View Trace" row lookup time filter', () => {
  beforeEach(() => {
    resetQueryState();
    mockUseRowData.mockReset();
    mockRowOverviewPanel.mockReset();
    mockRowDataPanel.mockReset();
    mockUseRowData.mockReturnValue(
      rowResult({
        row: {
          __hdx_trace_id: TRACE_ID,
          __hdx_span_id: SPAN_ID,
          __hdx_timestamp: DISPLAYED_TIMESTAMP,
          __hdx_timestamp_value_0: TIMESTAMP_VALUE,
        },
        meta: [{ name: '__hdx_timestamp_value_0', type: 'DateTime64(9)' }],
      }),
    );
  });

  it("stamps the row's timestampValueExpression timestamp onto the pushed frame", () => {
    renderInner('row-1');

    fireEvent.click(screen.getByTestId('side-panel-view-trace'));

    expect(pushedFrame()).toMatchObject({
      sourceId: 'trace-src',
      rowId: TRACE_SPAN_ROW_ID,
      focusTimestamp: new Date(TIMESTAMP_VALUE).toISOString(),
    });
    // Not the displayed timestamp, which may point at another column entirely.
    expect(pushedFrame().focusTimestamp).not.toBe(
      new Date(DISPLAYED_TIMESTAMP).toISOString(),
    );
  });

  // Regression: a composite "EventDate, EventTime" sort key leads with the
  // day-precision partition column. Anchoring the frame on it would center the
  // destination window on midnight and the span lookup would find no row.
  it('anchors a composite timestamp on its fine column, not the date', () => {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    const compositeSource = {
      ...ROOT_SOURCE,
      timestampValueExpression: 'EventDate, EventTime',
    } as TSource;

    mockUseRowData.mockReturnValue(
      rowResult({
        row: {
          __hdx_trace_id: TRACE_ID,
          __hdx_span_id: SPAN_ID,
          __hdx_timestamp_value_0: '2024-05-01',
          __hdx_timestamp_value_1: TIMESTAMP_VALUE,
        },
        meta: [
          { name: '__hdx_timestamp_value_0', type: 'Date' },
          { name: '__hdx_timestamp_value_1', type: 'DateTime64(9)' },
        ],
      }),
    );

    renderInner('row-1', compositeSource);

    fireEvent.click(screen.getByTestId('side-panel-view-trace'));

    expect(pushedFrame().focusTimestamp).toBe(
      new Date(TIMESTAMP_VALUE).toISOString(),
    );
  });

  // No usable anchor must leave the lookup unbounded rather than bound it to a
  // window around midnight.
  it.each([
    [
      'the row carries no timestamp value',
      {
        row: { __hdx_trace_id: TRACE_ID, __hdx_span_id: SPAN_ID },
        meta: [],
      },
    ],
    [
      'every timestamp column is day-precision',
      {
        row: {
          __hdx_trace_id: TRACE_ID,
          __hdx_span_id: SPAN_ID,
          __hdx_timestamp_value_0: '2024-05-01',
        },
        meta: [{ name: '__hdx_timestamp_value_0', type: 'Date' }],
      },
    ],
  ])('omits the frame timestamp when %s', (_label, result) => {
    mockUseRowData.mockReturnValue(rowResult(result));

    renderInner('row-1');

    fireEvent.click(screen.getByTestId('side-panel-view-trace'));

    expect(pushedFrame().focusTimestamp).toBeUndefined();
  });

  describe('with a landed frame', () => {
    function seedFrame(frame: Record<string, unknown>) {
      mockQueryStore['sidePanelSourceStack'] = [
        {
          sourceId: 'trace-src',
          rowId: TRACE_SPAN_ROW_ID,
          aliasWith: [],
          label: 'Log',
          sourceKind: 'trace',
          ...frame,
        },
      ];
      mockQueryStore['sidePanelStackRoot'] = 'row-1';
    }

    it('bounds the lookup to a window around the frame timestamp', () => {
      seedFrame({ focusTimestamp: TIMESTAMP_VALUE });

      renderInner('row-1');

      expect(lastRowDataArgs()).toMatchObject({
        rowId: TRACE_SPAN_ROW_ID,
        dateRange: lookupWindow(TIMESTAMP_VALUE),
      });
    });

    // Regression: the window is anchored on the origin log but filtered against
    // the destination span's *start*, so a symmetric hour excluded any span that
    // ran longer than that and logged late in its life.
    it('reaches back past the start of a long-running span', () => {
      const spanStart = new Date('2024-05-01T08:50:00.000Z');
      // 70 minutes into the span — outside a symmetric hour around the log.
      seedFrame({ focusTimestamp: TIMESTAMP_VALUE });

      renderInner('row-1');

      const [start, end] = lastRowDataArgs().dateRange;
      expect(start.getTime()).toBeLessThan(spanStart.getTime());
      expect(end.getTime()).toBeGreaterThan(
        new Date(TIMESTAMP_VALUE).getTime(),
      );
    });

    // The tab panels re-run the same lookup; an unbounded copy in one of them
    // would both scan the table and split the query cache.
    it.each([
      ['overview', () => mockRowOverviewPanel],
      ['parsed', () => mockRowDataPanel],
    ])('passes the same window to the %s tab', (tab, getSpy) => {
      seedFrame({
        sourceId: 'log-dest',
        sourceKind: 'log',
        focusTimestamp: TIMESTAMP_VALUE,
      });
      mockQueryStore['sidePanelTab'] = tab;

      renderInner('row-1');

      expect(getSpy()).toHaveBeenCalledWith(
        expect.objectContaining({ dateRange: lookupWindow(TIMESTAMP_VALUE) }),
      );
    });

    it('leaves the lookup unbounded when the frame carries no timestamp', () => {
      seedFrame({});

      renderInner('row-1');

      expect(lastRowDataArgs().dateRange).toBeUndefined();
    });

    it('leaves the lookup unbounded when the frame timestamp is unparseable', () => {
      seedFrame({ focusTimestamp: 'not-a-timestamp' });

      renderInner('row-1');

      expect(lastRowDataArgs().dateRange).toBeUndefined();
    });

    // Same-source drilldowns (surrounding context) carry a full row id whose
    // timestamp is already pinned, and can walk arbitrarily far from the frame's
    // anchor, so the frame's window must not be applied to them.
    it('leaves the lookup unbounded for a nav entry on top of the frame', () => {
      seedFrame({ focusTimestamp: TIMESTAMP_VALUE });
      mockQueryStore['sidePanelNavStack'] = [
        {
          rowId:
            "Timestamp=parseDateTime64BestEffort('2024-05-02 09:00:00', 9)",
          aliasWith: [],
          label: 'Neighbour',
        },
      ];

      renderInner('row-1');

      expect(lastRowDataArgs().dateRange).toBeUndefined();
    });
  });
});
