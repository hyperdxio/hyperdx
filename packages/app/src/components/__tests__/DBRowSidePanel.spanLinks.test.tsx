import React from 'react';
import SqlString from 'sqlstring';
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
    // eslint-disable-next-line @eslint-react/no-unnecessary-use-prefix
    useQueryState: (key: string, parser?: { defaultValue?: unknown }) => {
      const hasValue = Object.prototype.hasOwnProperty.call(
        mockQueryStore,
        key,
      );
      const fallback =
        parser && 'defaultValue' in parser ? parser.defaultValue : null;
      const value = hasValue ? mockQueryStore[key] : (fallback ?? null);
      const setters = mockSetters;
      if (!setters[key]) setters[key] = jest.fn();
      return [value, setters[key]];
    },
  };
});

// A single successful row carrying one span link and nothing else, so only
// the Span Links accordion section renders (Exception / Span Events /
// Resource / Event Attributes all stay gated off). RowOverviewPanel is left
// unmocked in this file so the real context wiring (DBRowSidePanelInner ->
// RowSidePanelContext.onOpenLinkedTrace -> RowOverviewPanel ->
// SpanLinksSubpanel.onOpenTrace) is exercised end to end.
const LINK = {
  TraceId: 'aaaa1111bbbb2222cccc3333dddd4444',
  SpanId: '1111222233334444',
  TraceState: '',
  Attributes: {},
};

const mockUseRowData = jest.fn();
jest.mock('../DBRowDataPanel', () => ({
  __esModule: true,
  useRowData: (args: unknown) => mockUseRowData(args),
  ROW_DATA_ALIASES: {
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

// The current row lives on a log source; the linked trace resolves against a
// separate trace source, the same split "View Trace" already relies on.
const TRACE_SOURCE = {
  id: 'trace-src',
  kind: 'trace',
  traceIdExpression: 'TraceId',
  spanIdExpression: 'SpanId',
};

jest.mock('@/source', () => ({
  __esModule: true,
  getEventBody: () => undefined,
  useSource: ({ id }: { id: string | null }) =>
    id === 'trace-src' ? { data: TRACE_SOURCE } : { data: undefined },
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
// this row shape (no trace tab, no exception/resource/event attributes).
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

// eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
const ROOT_SOURCE = {
  id: 'log-src',
  kind: 'log',
  traceSourceId: 'trace-src',
  // Makes hasOverviewPanel true so a non-trace source still gets an Overview
  // tab (and it is the default tab, since sourceIsTrace is false here).
  resourceAttributesExpression: 'ResourceAttributes',
} as TSource;

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

function renderInner(rowId: string) {
  return render(
    <MantineProvider>
      <InnerHarness rowId={rowId} />
    </MantineProvider>,
  );
}

describe('DBRowSidePanelInner, span link "Open trace" push wiring (HDX-3191)', () => {
  beforeEach(() => {
    resetQueryState();
    mockUseRowData.mockReset();
    mockUseRowData.mockReturnValue({
      data: { data: [{ __hdx_span_links: [LINK] }], meta: [] },
      isLoading: false,
      isSuccess: true,
      isError: false,
      error: null,
    });
  });

  it("pushes a trace-source frame keyed on the link's ids onto the shared source stack", () => {
    renderInner('row-1');

    fireEvent.click(screen.getByTestId('span-link-open-trace'));

    const expectedRowId = [
      SqlString.format('?=?', [SqlString.raw('TraceId'), LINK.TraceId]),
      SqlString.format('?=?', [SqlString.raw('SpanId'), LINK.SpanId]),
    ].join(' AND ');

    expect(setterFor('sidePanelSourceStack')).toHaveBeenCalledTimes(1);
    const pushedStack = setterFor('sidePanelSourceStack').mock.calls[0][0];
    expect(pushedStack).toHaveLength(1);
    expect(pushedStack[0]).toMatchObject({
      sourceId: 'trace-src',
      rowId: expectedRowId,
      sourceKind: 'trace',
    });
    expect(pushedStack[0].label).toContain(LINK.TraceId.slice(0, 8));

    // Cross-source push: nav stack clears and the destination tab is Trace,
    // matching handleSourceStackPush's Trace-vs-Overview routing.
    expect(setterFor('sidePanelNavStack')).toHaveBeenCalledWith([]);
    expect(setterFor('sidePanelTab')).toHaveBeenCalledWith('trace');
  });

  it('does not push when the current row has no resolvable trace source', () => {
    // Root source with no traceSourceId: traceSourceData never resolves, so
    // the guard in handleOpenLinkedTrace should no-op instead of throwing.
    const sourceWithoutTrace = {
      ...ROOT_SOURCE,
      traceSourceId: undefined,
    } as TSource;

    render(
      <MantineProvider>
        <InnerHarness rowId="row-2" source={sourceWithoutTrace} />
      </MantineProvider>,
    );

    fireEvent.click(screen.getByTestId('span-link-open-trace'));

    expect(setterFor('sidePanelSourceStack')).not.toHaveBeenCalled();
  });
});
