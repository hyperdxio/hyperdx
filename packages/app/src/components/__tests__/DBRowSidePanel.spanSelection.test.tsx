import { TSource } from '@hyperdx/common-utils/dist/types';
import { MantineProvider } from '@mantine/core';
import { fireEvent, render, screen } from '@testing-library/react';

// Controlled stand-in for nuqs. Values are the parsed shapes the panel reads.
// Prefixed with `mock` so the hoisted jest.mock factory can close over them.
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

jest.mock('../DBRowDataPanel', () => ({
  __esModule: true,
  useRowData: () => ({
    data: undefined,
    isLoading: false,
    isSuccess: false,
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
  useSource: () => ({ data: undefined, isLoading: false, isSuccess: false }),
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

import DBRowSidePanelErrorBoundary, {
  DBRowSidePanelInner,
} from '@/components/DBRowSidePanel';
import useSidePanelStack from '@/hooks/useSidePanelStack';

// eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
const ROOT_SOURCE = {
  id: 'log-src',
  kind: 'log',
  traceSourceId: 'trace-src',
} as TSource;

const urlSpan = {
  id: 'span-where',
  type: 'trace',
  aliasWith: [],
  traceId: 'trace-1',
};

function renderBoundary(rowId: string) {
  return render(
    <MantineProvider>
      <DBRowSidePanelErrorBoundary
        source={ROOT_SOURCE}
        rowId={rowId}
        aliasWith={[]}
        onClose={jest.fn()}
      />
    </MantineProvider>,
  );
}

function InnerHarness({
  rowId,
  onClose,
  onNavigateToParent,
}: {
  rowId: string;
  onClose: () => void;
  onNavigateToParent?: () => void;
}) {
  const sidePanelStack = useSidePanelStack({ initialRowId: rowId });
  return (
    <DBRowSidePanelInner
      source={ROOT_SOURCE}
      rowId={rowId}
      aliasWith={[]}
      onClose={onClose}
      onNavigateToParent={onNavigateToParent}
      sidePanelStack={sidePanelStack}
    />
  );
}

describe('DBRowSidePanelErrorBoundary span selection', () => {
  beforeEach(() => {
    resetQueryState();
    seedParam('eventRowWhere', urlSpan);
  });

  it('keeps an eventRowWhere that arrived with the URL on the first render', () => {
    renderBoundary('row-a');

    expect(setterFor('eventRowWhere')).not.toHaveBeenCalled();
  });

  it('clears the span when the opened row changes', () => {
    const view = renderBoundary('row-a');

    view.rerender(
      <MantineProvider>
        <DBRowSidePanelErrorBoundary
          source={ROOT_SOURCE}
          rowId="row-b"
          aliasWith={[]}
          onClose={jest.fn()}
        />
      </MantineProvider>,
    );

    expect(setterFor('eventRowWhere')).toHaveBeenCalledWith(null);
  });

  it('clears the span when the drawer closes', () => {
    renderBoundary('row-a');

    fireEvent.click(screen.getByLabelText('Close'));

    expect(setterFor('eventRowWhere')).toHaveBeenCalledWith(null);
  });

  it('clears the span when leaving an embedded event for its parent', () => {
    const onNavigateToParent = jest.fn();
    render(
      <MantineProvider>
        <InnerHarness
          rowId="row-a"
          onClose={jest.fn()}
          onNavigateToParent={onNavigateToParent}
        />
      </MantineProvider>,
    );

    fireEvent.click(screen.getByLabelText('Back'));

    expect(setterFor('eventRowWhere')).toHaveBeenCalledWith(null);
    expect(onNavigateToParent).toHaveBeenCalled();
  });
});
