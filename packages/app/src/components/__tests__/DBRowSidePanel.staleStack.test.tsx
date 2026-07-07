import React from 'react';
import { TSource } from '@hyperdx/common-utils/dist/types';
import { MantineProvider } from '@mantine/core';
import { render } from '@testing-library/react';

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

// Capture what row the panel actually resolves to. Returning isLoading short-
// circuits the render before the heavy body/header, so those children never
// mount and the `rowId` arg is the single source of truth for "what is shown".
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
}));

jest.mock('@/source', () => ({
  __esModule: true,
  getEventBody: () => '__hdx_body',
  // A non-null id resolves to a trace source so `isResolvingSource` is false and
  // the leaf frame's row id is used; a null id (no active frame) resolves to
  // undefined so the panel falls back to the root source.
  useSource: ({ id }: { id: string | null }) =>
    id ? { data: { id, kind: 'trace' } } : { data: undefined },
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
// under isLoading. Stub them so the module graph stays cheap to load.
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

const TRACE_FRAME = {
  sourceId: 'trace-src',
  rowId: 'leaf-row',
  aliasWith: [],
  label: 'Trace',
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

function lastResolvedRowId() {
  return mockUseRowData.mock.calls.at(-1)?.[0]?.rowId;
}

describe('DBRowSidePanelInner — stale stack handling (HDX-3942 "Stale Stack Remains")', () => {
  beforeEach(() => {
    resetQueryState();
    mockUseRowData.mockReset();
    mockUseRowData.mockReturnValue({
      data: undefined,
      isLoading: true,
      isSuccess: false,
      isError: false,
      error: null,
    });
  });

  it('preserves a deep-linked trail when the stack root matches the mounted row', () => {
    // A shared URL: stacks + a stackRoot that belongs to the mounted root row.
    seedParam('sidePanelSourceStack', [TRACE_FRAME]);
    seedParam('sidePanelNavStack', []);
    seedParam('sidePanelStackRoot', 'root-row');

    renderInner('root-row');

    // Trail is honoured: the drawer resolves the leaf frame's row, not the root.
    expect(lastResolvedRowId()).toBe('leaf-row');
    // ...and nothing is cleared.
    expect(setterFor('sidePanelSourceStack')).not.toHaveBeenCalled();
    expect(setterFor('sidePanelNavStack')).not.toHaveBeenCalled();
    expect(setterFor('sidePanelStackRoot')).not.toHaveBeenCalled();
  });

  it('ignores a stale trail left in the URL when a different root row mounts', () => {
    // Stacks survived an unclosed drawer / cross-table switch: their stackRoot
    // points at a *previous* root, but a different row is now mounted.
    seedParam('sidePanelSourceStack', [TRACE_FRAME]);
    seedParam('sidePanelNavStack', []);
    seedParam('sidePanelStackRoot', 'old-root');

    renderInner('new-root');

    // The row the user actually opened wins over the stale leaf. Correctness is
    // guaranteed at *read* time (the owner-gated trail is empty), so it does
    // NOT depend on any clearing effect firing.
    expect(lastResolvedRowId()).toBe('new-root');
  });

  it('ignores the trail when the root row changes while the panel stays mounted', () => {
    seedParam('sidePanelSourceStack', [TRACE_FRAME]);
    seedParam('sidePanelNavStack', []);
    seedParam('sidePanelStackRoot', 'root-1');

    const { rerender } = renderInner('root-1');
    // Same-root render keeps the trail.
    expect(lastResolvedRowId()).toBe('leaf-row');
    expect(setterFor('sidePanelSourceStack')).not.toHaveBeenCalled();

    // The mounted panel now points at a different root row (e.g. the user
    // clicked another row in the same table); the trail is stale and ignored.
    rerender(
      <MantineProvider>
        <InnerHarness rowId="root-2" />
      </MantineProvider>,
    );

    expect(lastResolvedRowId()).toBe('root-2');
  });

  it('treats an ownerless trail (no recorded root) as stale and ignores it', () => {
    // Malformed / truncated / pre-stackRoot URL: stacks present but no
    // stackRoot token. Every real push writes stackRoot alongside the stacks
    // (and shared links copy the full URL), so a stack we cannot prove owns the
    // mounted row must not shadow the row the user actually clicked.
    seedParam('sidePanelSourceStack', [TRACE_FRAME]);
    seedParam('sidePanelNavStack', []);
    // sidePanelStackRoot intentionally unseeded (null): ownerless.

    renderInner('some-row');

    // The clicked row wins over the ownerless leaf at read time.
    expect(lastResolvedRowId()).toBe('some-row');
  });
});
