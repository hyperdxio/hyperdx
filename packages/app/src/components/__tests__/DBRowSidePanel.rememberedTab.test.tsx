import React from 'react';
import { TSource } from '@hyperdx/common-utils/dist/types';
import { MantineProvider } from '@mantine/core';
import { act, render } from '@testing-library/react';

// Write-through in-memory nuqs so a real click *sequence* can be replayed: each
// setter updates the store and re-renders every subscribed hook, the way a URL
// param change would. The read-only mock used by the other side-panel suites
// can't express "click tab, then navigate" because writes never land.
const mockQueryStore: Record<string, unknown> = {};
const mockSubscribers = new Set<() => void>();
const mockSetters: Record<string, jest.Mock> = {};

function resetQueryState() {
  Object.keys(mockQueryStore).forEach(k => delete mockQueryStore[k]);
  Object.keys(mockSetters).forEach(k => delete mockSetters[k]);
  mockSubscribers.clear();
}

function setterFor(key: string) {
  if (!mockSetters[key]) {
    mockSetters[key] = jest.fn((value: unknown) => {
      const next =
        typeof value === 'function' ? value(mockQueryStore[key]) : value;
      if (next == null) {
        delete mockQueryStore[key];
      } else {
        mockQueryStore[key] = next;
      }
      mockSubscribers.forEach(fn => fn());
    });
  }
  return mockSetters[key];
}

jest.mock('nuqs', () => {
  const actual = jest.requireActual('nuqs');
  const react = jest.requireActual<typeof React>('react');
  return {
    ...actual,

    useQueryState: (key: string, parser?: { defaultValue?: unknown }) => {
      const [, forceRender] = react.useReducer((c: number) => c + 1, 0);
      react.useEffect(() => {
        mockSubscribers.add(forceRender);
        return () => {
          mockSubscribers.delete(forceRender);
        };
      }, [forceRender]);
      const hasValue = Object.prototype.hasOwnProperty.call(
        mockQueryStore,
        key,
      );
      const fallback =
        parser && 'defaultValue' in parser ? parser.defaultValue : null;
      const value = hasValue ? mockQueryStore[key] : (fallback ?? null);
      return [value, setterFor(key)];
    },
  };
});

const mockRow = {
  __hdx_timestamp: 1700000000,
  __hdx_body: 'a log line',
  __hdx_severity_text: 'info',
};

jest.mock('../DBRowDataPanel', () => ({
  __esModule: true,
  useRowData: () => ({
    data: { data: [mockRow] },
    isLoading: false,
    isSuccess: true,
    isError: false,
    error: null,
  }),
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
  useSource: () => ({ data: undefined }),
}));

// Capture the tab bar's props so the active tab can be asserted and a tab click
// driven through the component's real onClick handler.
const mockTabBarProps: {
  current: { activeItem?: unknown; onClick?: (v: unknown) => void };
} = { current: {} };
jest.mock('@/TabBar', () => ({
  __esModule: true,
  default: (props: {
    activeItem?: unknown;
    onClick?: (v: unknown) => void;
  }) => {
    mockTabBarProps.current = props;
    return null;
  },
}));

// Capture the surrounding-context panel's row-click callback so a drilldown can
// be triggered exactly as ContextSidePanel would.
type NavigateToRow = (
  rowId: string,
  aliasWith: unknown[],
  label: string,
  sourceKind?: string,
) => void;
const mockContextProps: { current: { onNavigateToRow?: NavigateToRow } } = {
  current: {},
};
jest.mock('../ContextSidePanel', () => ({
  __esModule: true,
  default: (props: { onNavigateToRow?: NavigateToRow }) => {
    mockContextProps.current = props;
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
import useSidePanelStack, {
  LAST_TAB_STORAGE_KEY,
} from '@/hooks/useSidePanelStack';

// A log source with attribute expressions so an Overview tab exists, making
// `defaultTab` Overview — the tab the user keeps getting dumped back onto.
// eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
const LOG_SOURCE = {
  id: 'log-src',
  kind: 'log',
  resourceAttributesExpression: 'ResourceAttributes',
  eventAttributesExpression: 'LogAttributes',
} as TSource;

function Harness({ rowId }: { rowId: string }) {
  const sidePanelStack = useSidePanelStack({ initialRowId: rowId });
  return (
    <DBRowSidePanelInner
      source={LOG_SOURCE}
      rowId={rowId}
      aliasWith={[]}
      onClose={jest.fn()}
      sidePanelStack={sidePanelStack}
    />
  );
}

function renderPanel(rowId: string) {
  return render(
    <MantineProvider>
      <Harness rowId={rowId} />
    </MantineProvider>,
  );
}

function activeTab() {
  return mockTabBarProps.current.activeItem;
}

function clickTab(tab: Tab) {
  act(() => mockTabBarProps.current.onClick?.(tab));
}

function clickContextRow(rowId: string) {
  act(() =>
    mockContextProps.current.onNavigateToRow?.(rowId, [], 'Other log', 'log'),
  );
}

describe('DBRowSidePanelInner — remembered tab across a surrounding-context drilldown', () => {
  beforeEach(() => {
    resetQueryState();
    localStorage.clear();
    mockTabBarProps.current = {};
    mockContextProps.current = {};
  });

  it('opens on the default tab when nothing has been remembered yet', () => {
    renderPanel('row-1');
    expect(activeTab()).toBe(Tab.Overview);
  });

  it('keeps the reader on Column Values after drilling through Surrounding Context', () => {
    renderPanel('row-1');
    expect(activeTab()).toBe(Tab.Overview);

    // The reader picks their preferred view...
    clickTab(Tab.Parsed);
    expect(activeTab()).toBe(Tab.Parsed);

    // ...then uses Surrounding Context purely to find a neighbouring row.
    clickTab(Tab.Context);
    expect(activeTab()).toBe(Tab.Context);

    clickContextRow('row-2');

    // The drilldown must land on the reader's preferred view, not reset to the
    // source default, and not strand them on Surrounding Context.
    expect(activeTab()).toBe(Tab.Parsed);
  });

  it('does not let Surrounding Context become the remembered preference', () => {
    renderPanel('row-1');
    clickTab(Tab.Parsed);
    clickTab(Tab.Context);

    expect(JSON.parse(localStorage.getItem(LAST_TAB_STORAGE_KEY)!)).toBe(
      Tab.Parsed,
    );
  });

  it('still honours a targeted tab when one is explicitly requested', () => {
    renderPanel('row-1');
    clickTab(Tab.Parsed);

    // A cross-source jump (e.g. "View Trace") targets its own tab and must win.
    act(() => mockTabBarProps.current.onClick?.(Tab.Overview));
    expect(activeTab()).toBe(Tab.Overview);
  });
});
