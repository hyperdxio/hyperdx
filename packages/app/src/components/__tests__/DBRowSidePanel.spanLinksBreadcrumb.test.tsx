import React from 'react';
import { TSource } from '@hyperdx/common-utils/dist/types';
import { MantineProvider } from '@mantine/core';
import { fireEvent, render, screen } from '@testing-library/react';

// Reactive replacement for nuqs' useQueryState: backing each param with a real
// useState so a span-link "Open trace" push actually re-renders the panel with
// the new source frame (the shared drawer stack behaves as it does in the app).
// This is what lets us observe the breadcrumb label resolve after the hop
// loads, which the sibling push-wiring test cannot do (it mocks the setters).
jest.mock('nuqs', () => {
  const actualReact = jest.requireActual('react');
  const actual = jest.requireActual('nuqs');
  return {
    ...actual,
    useQueryState: (_key: string, parser?: { defaultValue?: unknown }) => {
      const fallback =
        parser && 'defaultValue' in parser ? parser.defaultValue : null;
      const [value, setValue] = actualReact.useState(fallback ?? null);
      return [value, setValue];
    },
  };
});

// One span link on the root row. Its destination row (keyed on the link's ids)
// carries a span name in __hdx_body; the breadcrumb hop should show that name
// instead of the `Trace <id>` fallback the frame is pushed with.
const LINK = {
  TraceId: 'aaaa1111bbbb2222cccc3333dddd4444',
  SpanId: '1111222233334444',
  TraceState: '',
  Attributes: {},
};

const ROOT_SPAN_NAME = 'POST /api/checkout';
const LINKED_SPAN_NAME = 'consume order.created';

const mockUseRowData = jest.fn();
jest.mock('../DBRowDataPanel', () => ({
  __esModule: true,
  // eslint-disable-next-line @eslint-react/no-unnecessary-use-prefix
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

const TRACE_SOURCE = {
  id: 'trace-src',
  kind: 'trace',
  traceIdExpression: 'TraceId',
  spanIdExpression: 'SpanId',
};

jest.mock('@/source', () => ({
  __esModule: true,
  getEventBody: () => undefined,
  // eslint-disable-next-line @eslint-react/no-unnecessary-use-prefix
  useSource: ({ id }: { id: string | null }) =>
    id === 'trace-src' ? { data: TRACE_SOURCE } : { data: undefined },
}));

jest.mock('../DBSessionPanel', () => ({
  __esModule: true,
  // eslint-disable-next-line @eslint-react/no-unnecessary-use-prefix
  useSessionId: () => ({ rumSessionId: undefined, rumServiceName: undefined }),
  DBSessionPanel: () => null,
}));

jest.mock('@/utils/highlightedAttributes', () => ({
  __esModule: true,
  getHighlightedAttributesFromData: () => [],
}));

// Trace tab content is irrelevant here; only the breadcrumb bar is asserted.
// SidePanelBreadcrumbs is intentionally NOT mocked so its rendered labels can
// be read.
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

// Placed after the mock factories, matching the sibling span-link test.
import { DBRowSidePanelInner } from '@/components/DBRowSidePanel';
import useSidePanelStack from '@/hooks/useSidePanelStack';

// eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
const ROOT_SOURCE = {
  id: 'log-src',
  kind: 'log',
  traceSourceId: 'trace-src',
  resourceAttributesExpression: 'ResourceAttributes',
} as TSource;

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

describe('DBRowSidePanelInner, span-link breadcrumb labels (HDX-3191)', () => {
  beforeEach(() => {
    mockUseRowData.mockReset();
    // The root row (log) carries the span link; the linked trace row (keyed on
    // the link's TraceId) carries the destination span name and no links.
    mockUseRowData.mockImplementation((args: { rowId?: string }) => {
      const rowId = args?.rowId ?? '';
      const isLinkedTrace =
        typeof rowId === 'string' && rowId.includes(LINK.TraceId);
      return {
        data: {
          data: [
            isLinkedTrace
              ? { __hdx_body: LINKED_SPAN_NAME, __hdx_span_links: [] }
              : { __hdx_body: ROOT_SPAN_NAME, __hdx_span_links: [LINK] },
          ],
          meta: [],
        },
        isLoading: false,
        isSuccess: true,
        isError: false,
        error: null,
      };
    });
  });

  it('shows the landed span name for a span-link hop instead of the Trace-id fallback', async () => {
    render(
      <MantineProvider>
        <InnerHarness rowId="row-1" />
      </MantineProvider>,
    );

    fireEvent.click(screen.getByTestId('span-link-open-trace'));

    // The hop crumb resolves to the destination span name once its row loads.
    expect(await screen.findByText(LINKED_SPAN_NAME)).toBeInTheDocument();
    // The root crumb still shows the originating span name.
    expect(screen.getByText(ROOT_SPAN_NAME)).toBeInTheDocument();
    // The `Trace <id>` fallback is no longer shown for the resolved hop.
    expect(
      screen.queryByText(new RegExp(`^Trace ${LINK.TraceId.slice(0, 8)}`)),
    ).not.toBeInTheDocument();
  });
});
