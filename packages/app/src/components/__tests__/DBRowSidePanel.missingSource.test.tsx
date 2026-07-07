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

function seedParam(key: string, value: unknown) {
  mockQueryStore[key] = value;
}
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

// Row data resolves off the requested rowId: when the panel skips the row query
// (leaf source loading or unresolvable) it passes `rowId: undefined`, which must
// NOT report `isLoading` — otherwise the loading branch would mask the
// missing-source branch we are asserting.
const mockUseRowData = jest.fn();
jest.mock('../DBRowDataPanel', () => ({
  __esModule: true,
  useRowData: (args: { rowId?: string }) => mockUseRowData(args),
  ROW_DATA_ALIASES: {
    DURATION_MS: '__hdx_duration',
    SPAN_KIND: '__hdx_span_kind',
    SERVICE_NAME: '__hdx_service_name',
    SEVERITY_TEXT: '__hdx_severity_text',
  },
  rowHasK8sContext: () => false,
  RowDataPanel: () => null,
}));

// Per-id source resolution state. An id absent from the store models the
// react-query `select` returning `undefined` for a deleted/renamed id even
// after the query has settled successfully.
const mockSourceStore: Record<
  string,
  { data: unknown; isLoading: boolean; isSuccess: boolean }
> = {};
jest.mock('@/source', () => ({
  __esModule: true,
  getEventBody: () => '__hdx_body',
  useSource: ({ id }: { id: string | null }) => {
    if (id == null) {
      return { data: undefined, isLoading: false, isSuccess: false };
    }
    if (Object.prototype.hasOwnProperty.call(mockSourceStore, id)) {
      return mockSourceStore[id];
    }
    // Settled, but the id no longer maps to a source.
    return { data: undefined, isLoading: false, isSuccess: true };
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

// Heavy leaf components / chart deps that the panel imports but never renders
// under the loading / missing-source branches. Stub them so the module graph
// stays cheap to load. NOTE: SidePanelBreadcrumbs is intentionally *not* mocked
// so we can assert the Back control is present in the error state.
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
} as TSource;

// A cross-source frame (e.g. "View Trace") whose source id no longer resolves.
const MISSING_FRAME = {
  sourceId: 'deleted-src',
  rowId: 'leaf-row',
  aliasWith: [],
  label: 'Deleted Trace',
  sourceKind: 'trace',
};

function InnerHarness({ rowId }: { rowId: string }) {
  const sidePanelStack = useSidePanelStack({ initialRowId: rowId });
  return (
    <DBRowSidePanelInner
      source={ROOT_SOURCE}
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

describe('DBRowSidePanelInner — unresolvable stack source (HDX-3942 permanent-loading P0)', () => {
  beforeEach(() => {
    resetQueryState();
    Object.keys(mockSourceStore).forEach(k => delete mockSourceStore[k]);
    mockUseRowData.mockReset();
    // Not loading when there is no row to query (the missing/loading source
    // branches pass rowId: undefined); loading otherwise.
    mockUseRowData.mockImplementation((args: { rowId?: string }) =>
      args?.rowId == null
        ? {
            data: undefined,
            isLoading: false,
            isSuccess: false,
            isError: false,
            error: null,
          }
        : {
            data: undefined,
            isLoading: true,
            isSuccess: false,
            isError: false,
            error: null,
          },
    );
  });

  it('renders an error state with working Back/Close instead of hanging on Loading when the leaf source id no longer resolves', () => {
    // A shared URL points at a cross-source frame whose source was deleted /
    // renamed / lives in another workspace. Its stackRoot matches the mounted
    // row so the trail is treated as valid (not stale).
    seedParam('sidePanelSourceStack', [MISSING_FRAME]);
    seedParam('sidePanelNavStack', []);
    seedParam('sidePanelStackRoot', 'root-row');

    renderInner('root-row');

    // Not stuck on "Loading..." — an explicit, actionable message is shown.
    expect(screen.queryByText('Loading...')).not.toBeInTheDocument();
    expect(
      screen.getByText(/source is no longer available/i),
    ).toBeInTheDocument();

    // The trail collapse controls remain usable.
    const back = screen.getByLabelText('Back');
    const close = screen.getByLabelText('Close');
    expect(back).toBeInTheDocument();
    expect(close).toBeInTheDocument();

    // Back pops the broken frame off the source stack.
    fireEvent.click(back);
    expect(setterFor('sidePanelSourceStack')).toHaveBeenCalled();
  });

  it('still shows Loading while the leaf source query is genuinely in flight', () => {
    mockSourceStore['deleted-src'] = {
      data: undefined,
      isLoading: true,
      isSuccess: false,
    };
    seedParam('sidePanelSourceStack', [MISSING_FRAME]);
    seedParam('sidePanelNavStack', []);
    seedParam('sidePanelStackRoot', 'root-row');

    renderInner('root-row');

    expect(screen.getByText('Loading...')).toBeInTheDocument();
    expect(
      screen.queryByText(/source is no longer available/i),
    ).not.toBeInTheDocument();
  });

  it('renders the row normally once the leaf source resolves', () => {
    mockSourceStore['deleted-src'] = {
      data: { id: 'deleted-src', kind: 'trace' },
      isLoading: false,
      isSuccess: true,
    };
    seedParam('sidePanelSourceStack', [MISSING_FRAME]);
    seedParam('sidePanelNavStack', []);
    seedParam('sidePanelStackRoot', 'root-row');

    renderInner('root-row');

    // Source resolved → the leaf row is queried (isLoading true → "Loading..."),
    // and the missing-source error state is not shown.
    expect(
      screen.queryByText(/source is no longer available/i),
    ).not.toBeInTheDocument();
    const resolvedRowId = mockUseRowData.mock.calls.at(-1)?.[0]?.rowId;
    expect(resolvedRowId).toBe('leaf-row');
  });
});
