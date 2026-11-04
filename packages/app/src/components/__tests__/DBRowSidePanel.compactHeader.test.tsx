import React from 'react';
import { TSource } from '@hyperdx/common-utils/dist/types';
import { MantineProvider } from '@mantine/core';
import { render } from '@testing-library/react';

import { makeLogSource, makeTraceSource } from '@/llm/__fixtures__/sources';

// In-memory nuqs so a test can seed the side panel stack. Prefixed with
// `mock` so jest.mock factories may reference it.
const mockQueryStore: Record<string, unknown> = {};
jest.mock('nuqs', () => {
  const actual = jest.requireActual('nuqs');
  return {
    ...actual,
    useQueryState: (key: string, parser?: { defaultValue?: unknown }) => [
      key in mockQueryStore
        ? mockQueryStore[key]
        : parser && 'defaultValue' in parser
          ? parser.defaultValue
          : null,
      jest.fn(),
    ],
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

// Resolves the trace source a "View Trace" frame points at.
const mockStackSource: { current: TSource | undefined } = {
  current: undefined,
};
jest.mock('@/source', () => ({
  __esModule: true,
  getEventBody: () => 'SpanName',
  useSource: ({ id }: { id: string | null }) =>
    id != null && id === mockStackSource.current?.id
      ? { data: mockStackSource.current, isSuccess: true, isLoading: false }
      : { data: undefined },
}));

type HeaderProps = { bodyShownInTitle?: boolean; mainContent?: string };
const mockHeaderProps: { current: HeaderProps } = { current: {} };
jest.mock('../DBRowSidePanelHeader', () => ({
  __esModule: true,
  default: (props: HeaderProps) => {
    mockHeaderProps.current = props;
    return null;
  },
}));

// Records the attribute expressions the panel asks to highlight.
const mockHighlightedExpressions: { current: { sqlExpression: string }[] } = {
  current: [],
};
jest.mock('@/utils/highlightedAttributes', () => ({
  __esModule: true,
  getHighlightedAttributesFromData: (
    _source: unknown,
    expressions: { sqlExpression: string }[],
  ) => {
    mockHighlightedExpressions.current = expressions;
    return [];
  },
}));

jest.mock('@/TabBar', () => ({ __esModule: true, default: () => null }));
jest.mock('../TraceLogsPanel', () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock('../DBSessionPanel', () => ({
  __esModule: true,
  useSessionId: () => ({ rumSessionId: undefined, rumServiceName: undefined }),
  DBSessionPanel: () => null,
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
import useSidePanelStack from '@/hooks/useSidePanelStack';

const TIMESTAMP_VALUE = '2024-05-01T10:00:00.123456789Z';

function rowResult(row: Record<string, unknown>) {
  return {
    data: {
      data: [
        {
          __hdx_trace_id: '7316d5a2ab0dc2efa72258f64a98a405',
          __hdx_span_id: 'e3748131832d6176',
          __hdx_timestamp: TIMESTAMP_VALUE,
          __hdx_timestamp_value_0: TIMESTAMP_VALUE,
          __hdx_service_name: 'frontend',
          ...row,
        },
      ],
      meta: [{ name: '__hdx_timestamp_value_0', type: 'DateTime64(9)' }],
    },
    isLoading: false,
    isSuccess: true,
    isError: false,
    error: null,
  };
}

function renderPanel(
  source: TSource,
  { parentBreadcrumbs }: { parentBreadcrumbs?: { label: string }[] } = {},
) {
  function Harness() {
    const sidePanelStack = useSidePanelStack({ initialRowId: 'row-1' });
    return (
      <DBRowSidePanelInner
        source={source}
        rowId="row-1"
        aliasWith={[]}
        onClose={jest.fn()}
        sidePanelStack={sidePanelStack}
        parentBreadcrumbs={parentBreadcrumbs}
      />
    );
  }
  return render(
    <MantineProvider>
      <Harness />
    </MantineProvider>,
  );
}

describe('DBRowSidePanelInner: compact header', () => {
  beforeEach(() => {
    localStorage.clear();
    Object.keys(mockQueryStore).forEach(k => delete mockQueryStore[k]);
    mockStackSource.current = undefined;
    mockHeaderProps.current = {};
    mockHighlightedExpressions.current = [];
    mockUseRowData.mockReset();
  });

  it('skips the body paper on a trace span whose name is the panel title', () => {
    mockUseRowData.mockReturnValue(rowResult({ __hdx_body: 'GET /checkout' }));
    renderPanel(makeTraceSource());

    expect(mockHeaderProps.current.mainContent).toBe('GET /checkout');
    expect(mockHeaderProps.current.bodyShownInTitle).toBe(true);
  });

  it('keeps the body paper when the span name is too long for the title', () => {
    mockUseRowData.mockReturnValue(
      rowResult({ __hdx_body: `SELECT ${'column, '.repeat(30)}id FROM t` }),
    );
    renderPanel(makeTraceSource());

    expect(mockHeaderProps.current.bodyShownInTitle).toBe(false);
  });

  it('skips the body paper when a breadcrumb trail ends on the span name', () => {
    mockUseRowData.mockReturnValue(rowResult({ __hdx_body: 'GET /checkout' }));
    renderPanel(makeTraceSource(), {
      parentBreadcrumbs: [{ label: 'Session' }],
    });

    expect(mockHeaderProps.current.bodyShownInTitle).toBe(true);
  });

  it('keeps the body paper when the trail truncates the span name', () => {
    // Longer than the current crumb's limit in a trail, shorter than a lone
    // title's limit.
    mockUseRowData.mockReturnValue(
      rowResult({ __hdx_body: `GET /api/${'segment/'.repeat(6)}id` }),
    );
    renderPanel(makeTraceSource(), {
      parentBreadcrumbs: [{ label: 'Session' }],
    });

    expect(mockHeaderProps.current.bodyShownInTitle).toBe(false);
  });

  it('keeps the body paper after View Trace, where the title is the log', () => {
    const traceSource = makeTraceSource();
    mockStackSource.current = traceSource;
    mockQueryStore.sidePanelStackRoot = 'row-1';
    mockQueryStore.sidePanelSourceStack = [
      {
        sourceId: traceSource.id,
        rowId: 'span-row',
        aliasWith: [],
        label: 'Checkout failed for user u_18342',
        sourceKind: traceSource.kind,
      },
    ];
    mockUseRowData.mockReturnValue(rowResult({ __hdx_body: 'GET /checkout' }));
    renderPanel(makeLogSource());

    expect(mockHeaderProps.current.mainContent).toBe('GET /checkout');
    expect(mockHeaderProps.current.bodyShownInTitle).toBe(false);
  });

  it('keeps the body paper on log rows', () => {
    mockUseRowData.mockReturnValue(rowResult({ __hdx_body: 'a log line' }));
    renderPanel(makeLogSource());

    expect(mockHeaderProps.current.bodyShownInTitle).toBe(false);
  });

  it('does not repeat the service as a highlighted chip on trace spans', () => {
    mockUseRowData.mockReturnValue(rowResult({ __hdx_body: 'GET /checkout' }));
    renderPanel(makeTraceSource());

    expect(mockHighlightedExpressions.current).not.toContainEqual({
      sqlExpression: 'ServiceName',
    });
  });

  it('still highlights the service on log rows', () => {
    mockUseRowData.mockReturnValue(rowResult({ __hdx_body: 'a log line' }));
    renderPanel(makeLogSource());

    expect(mockHighlightedExpressions.current).toContainEqual({
      sqlExpression: 'ServiceName',
    });
  });

  it('keeps highlighted expressions configured on a trace source', () => {
    mockUseRowData.mockReturnValue(rowResult({ __hdx_body: 'GET /checkout' }));
    renderPanel(
      makeTraceSource({
        highlightedRowAttributeExpressions: [
          { sqlExpression: "SpanAttributes['http.method']" },
        ],
      }),
    );

    expect(mockHighlightedExpressions.current).toEqual([
      { sqlExpression: "SpanAttributes['http.method']" },
    ]);
  });
});
