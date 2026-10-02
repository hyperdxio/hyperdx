import React from 'react';
import { SourceKind } from '@hyperdx/common-utils/dist/types';
import { act, fireEvent, screen } from '@testing-library/react';

import { RowSidePanelContext } from '@/components/DBRowSidePanel';
import DBTracePanel from '@/components/DBTracePanel';

let mockSources: Record<string, any> = {};
// Controls the value returned by the mocked `useQueryState('eventRowWhere')`
// so tests can render with or without a selected span. Prefixed with `mock` so
// the hoisted jest.mock factory may reference it.
type MockSelection = {
  id: string;
  type: string;
  aliasWith: unknown[];
  traceId?: string;
} | null;

let mockEventRowWhere: MockSelection = null;
const mockSetEventRowWhere = jest.fn();
// Lets a test land a URL value the way a late nuqs commit would.
let mockCommitUrl: (value: MockSelection) => void = () => {};

jest.mock('nuqs', () => ({
  ...jest.requireActual('nuqs'),
  useQueryState: () => {
    const { useCallback, useState } = jest.requireActual('react');
    const [value, setValue] = useState(() => mockEventRowWhere);
    mockCommitUrl = setValue;
    const set = useCallback((next: MockSelection) => {
      mockSetEventRowWhere(next);
      setValue(next);
    }, []);
    return [value, set];
  },
}));

jest.mock('@/source', () => ({
  useSource: ({ id }: { id?: string | null }) => ({
    data: id ? mockSources[id] : undefined,
    isLoading: false,
  }),
  useUpdateSource: () => ({
    mutate: jest.fn(),
  }),
}));

jest.mock('@/components/DBTraceWaterfallChart', () => ({
  DBTraceWaterfallChartContainer: ({
    emptyState,
    controlsExtra,
    onClick,
    highlightedRowWhere,
  }: {
    emptyState?: React.ReactNode;
    controlsExtra?: React.ReactNode;
    onClick?: (rowWhere: {
      id: string;
      type: string;
      aliasWith: never[];
    }) => void;
    highlightedRowWhere?: string | null;
  }) => (
    <div>
      {controlsExtra}
      {emptyState ?? 'waterfall'}
      <div data-testid="highlighted-row">{String(highlightedRowWhere)}</div>
      {['span-a', 'span-b'].map(id => (
        <button
          key={id}
          onClick={() => onClick?.({ id, type: 'trace', aliasWith: [] })}
        >
          select {id}
        </button>
      ))}
    </div>
  ),
}));

jest.mock('../SourceSelect', () => ({
  SourceSelectControlled: () => <div>source select</div>,
}));

// useRowData runs unconditionally (for the Infrastructure tab / k8s detection)
// and would otherwise need a QueryClient provider; stub it for this unit test.
jest.mock('../DBRowDataPanel', () => ({
  useRowData: () => ({ data: undefined }),
  rowHasK8sContext: () => false,
  RowDataPanel: () => <div>row data panel</div>,
}));

// Stands in for the real overview panel but still consumes the (real)
// RowSidePanelContext, so the tests below can observe the source-aware
// context SpanDetailPanel derives for the selected event (HDX-5040).
jest.mock('../DBRowOverviewPanel', () => ({
  RowOverviewPanel: ({ rowId }: { rowId?: string | null }) => {
    const ReactActual = jest.requireActual('react');
    // Required lazily so the circular DBTracePanel <-> DBRowSidePanel import
    // is fully initialized by render time.
    const { RowSidePanelContext: Ctx } =
      jest.requireActual('../DBRowSidePanel');
    const ctx = ReactActual.use(Ctx);
    return (
      <div>
        <div>overview panel</div>
        <div data-testid="overview-row-id">{String(rowId)}</div>
        <button
          onClick={() =>
            ctx.generateSearchUrl?.({ where: 'x', whereLanguage: 'sql' })
          }
        >
          generate search url
        </button>
        <div data-testid="can-add-to-filters">
          {ctx.onPropertyAddClick ? 'yes' : 'no'}
        </div>
      </div>
    );
  },
}));

jest.mock('../DBInfraPanel', () => ({
  __esModule: true,
  default: () => <div>infra panel</div>,
}));

jest.mock('../SourceSchemaPreview', () => ({
  __esModule: true,
  default: () => <div />,
  isSourceSchemaPreviewEnabled: () => false,
  getSourceSchemaTables: () => [],
}));

describe('DBTracePanel', () => {
  beforeEach(() => {
    mockEventRowWhere = null;
    mockSetEventRowWhere.mockClear();
    mockSources = {
      'trace-source': {
        id: 'trace-source',
        kind: SourceKind.Trace,
        traceIdExpression: 'TraceId',
        logSourceId: 'log-source',
      },
      'log-source': {
        id: 'log-source',
        kind: SourceKind.Log,
        traceIdExpression: 'TraceId',
      },
    };
  });

  it('passes through a custom empty state to the waterfall container', () => {
    renderWithMantine(
      <DBTracePanel
        traceId="trace-123"
        parentSourceId="trace-source"
        childSourceId="log-source"
        dateRange={[new Date(0), new Date(1000)]}
        focusDate={new Date(500)}
        emptyState={<div>Trace not found</div>}
      />,
    );

    expect(screen.getByText('Trace not found')).toBeInTheDocument();
  });

  it('moves the correlated logs source selector into the waterfall controls', () => {
    renderWithMantine(
      <DBTracePanel
        traceId="trace-123"
        parentSourceId="trace-source"
        childSourceId="log-source"
        dateRange={[new Date(0), new Date(1000)]}
        focusDate={new Date(500)}
      />,
    );

    // The selector (mocked) now renders inside the waterfall controls bar.
    expect(screen.getByText('source select')).toBeInTheDocument();
    expect(screen.getByText('Correlated logs')).toBeInTheDocument();
  });

  it('does not duplicate the trace id in the panel body', () => {
    renderWithMantine(
      <DBTracePanel
        traceId="trace-123"
        parentSourceId="trace-source"
        childSourceId="log-source"
        dateRange={[new Date(0), new Date(1000)]}
        focusDate={new Date(500)}
      />,
    );

    // Trace id lives in the side-panel header now, not the trace panel body.
    expect(screen.queryByText(/trace-123/)).not.toBeInTheDocument();
  });

  it('toggles the span detail layout and persists the choice', () => {
    localStorage.clear();
    mockEventRowWhere = {
      id: 'span-1',
      type: SourceKind.Trace,
      aliasWith: [],
      traceId: 'trace-123',
    };
    renderWithMantine(
      <DBTracePanel
        traceId="trace-123"
        parentSourceId="trace-source"
        childSourceId="log-source"
        dateRange={[new Date(0), new Date(1000)]}
        focusDate={new Date(500)}
      />,
    );

    const toggle = screen.getByTestId('trace-detail-layout-toggle');

    // Default 'side' layout: the control offers switching to the bottom layout.
    expect(
      toggle.querySelector('.tabler-icon-layout-bottombar'),
    ).toBeInTheDocument();

    fireEvent.click(toggle);
    // Now in 'bottom' layout: the control offers switching back to the side.
    expect(
      toggle.querySelector('.tabler-icon-layout-sidebar-right'),
    ).toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem('hdx_trace_detail_layout')!)).toBe(
      'bottom',
    );

    fireEvent.click(toggle);
    // Back to 'side'; leave the shared atom at its default for other tests.
    expect(
      toggle.querySelector('.tabler-icon-layout-bottombar'),
    ).toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem('hdx_trace_detail_layout')!)).toBe(
      'side',
    );
  });

  describe('span selection ownership', () => {
    const renderPanel = () =>
      renderWithMantine(
        <DBTracePanel
          traceId="trace-123"
          parentSourceId="trace-source"
          childSourceId="log-source"
          dateRange={[new Date(0), new Date(1000)]}
          focusDate={new Date(500)}
        />,
      );

    it('opens the clicked span without waiting for the URL to come back', () => {
      renderPanel();

      fireEvent.click(screen.getByText('select span-b'));

      expect(screen.getByTestId('overview-row-id')).toHaveTextContent('span-b');
      expect(screen.getByTestId('highlighted-row')).toHaveTextContent('span-b');
      expect(mockSetEventRowWhere).toHaveBeenLastCalledWith(
        expect.objectContaining({ id: 'span-b', traceId: 'trace-123' }),
      );
    });

    it('switches to the newly clicked span', () => {
      renderPanel();

      fireEvent.click(screen.getByText('select span-a'));
      fireEvent.click(screen.getByText('select span-b'));

      expect(screen.getByTestId('overview-row-id')).toHaveTextContent('span-b');
    });

    it('keeps the clicked span and corrects the URL after a late commit', () => {
      renderPanel();
      fireEvent.click(screen.getByText('select span-a'));
      fireEvent.click(screen.getByText('select span-b'));
      mockSetEventRowWhere.mockClear();

      act(() =>
        mockCommitUrl({
          id: 'span-a',
          type: SourceKind.Trace,
          aliasWith: [],
          traceId: 'trace-123',
        }),
      );

      expect(screen.getByTestId('overview-row-id')).toHaveTextContent('span-b');
      expect(mockSetEventRowWhere).toHaveBeenLastCalledWith(
        expect.objectContaining({ id: 'span-b' }),
      );
    });

    it('leaves a URL value written by another panel alone', () => {
      renderPanel();
      fireEvent.click(screen.getByText('select span-b'));
      mockSetEventRowWhere.mockClear();

      act(() =>
        mockCommitUrl({
          id: 'span-other',
          type: SourceKind.Trace,
          aliasWith: [],
          traceId: 'trace-123',
        }),
      );

      expect(screen.getByTestId('overview-row-id')).toHaveTextContent('span-b');
      expect(mockSetEventRowWhere).not.toHaveBeenCalled();
    });

    it('keeps a destination span that reaches the URL before the trace changes', () => {
      const TraceSwitcher = () => {
        const [traceId, setTraceId] = React.useState('trace-123');
        return (
          <>
            <button onClick={() => setTraceId('trace-456')}>switch</button>
            <DBTracePanel
              traceId={traceId}
              parentSourceId="trace-source"
              childSourceId="log-source"
              dateRange={[new Date(0), new Date(1000)]}
              focusDate={new Date(500)}
            />
          </>
        );
      };
      renderWithMantine(<TraceSwitcher />);
      fireEvent.click(screen.getByText('select span-b'));
      mockSetEventRowWhere.mockClear();

      act(() =>
        mockCommitUrl({
          id: 'span-x',
          type: SourceKind.Trace,
          aliasWith: [],
          traceId: 'trace-456',
        }),
      );
      fireEvent.click(screen.getByText('switch'));

      expect(screen.getByTestId('overview-row-id')).toHaveTextContent('span-x');
      expect(mockSetEventRowWhere).not.toHaveBeenCalled();
    });

    it('stays closed when a late commit brings back a span', () => {
      renderPanel();
      fireEvent.click(screen.getByText('select span-b'));
      fireEvent.click(screen.getByLabelText('Close span details'));

      act(() =>
        mockCommitUrl({
          id: 'span-b',
          type: SourceKind.Trace,
          aliasWith: [],
          traceId: 'trace-123',
        }),
      );

      expect(screen.queryByTestId('overview-row-id')).not.toBeInTheDocument();
      expect(mockSetEventRowWhere).toHaveBeenLastCalledWith(null);
    });

    it('restores a URL selection on mount only for its own trace', () => {
      mockEventRowWhere = {
        id: 'span-from-url',
        type: SourceKind.Trace,
        aliasWith: [],
        traceId: 'trace-123',
      };
      const { unmount } = renderPanel();
      expect(screen.getByTestId('overview-row-id')).toHaveTextContent(
        'span-from-url',
      );
      unmount();

      mockEventRowWhere = { ...mockEventRowWhere, traceId: 'trace-other' };
      renderPanel();
      expect(screen.queryByTestId('overview-row-id')).not.toBeInTheDocument();
    });

    it('shows the span a URL selects when the panel moves to that trace', () => {
      const TraceSwitcher = () => {
        const [traceId, setTraceId] = React.useState('trace-123');
        return (
          <>
            <button onClick={() => setTraceId('trace-456')}>switch</button>
            <DBTracePanel
              traceId={traceId}
              parentSourceId="trace-source"
              childSourceId="log-source"
              dateRange={[new Date(0), new Date(1000)]}
              focusDate={new Date(500)}
            />
          </>
        );
      };
      renderWithMantine(<TraceSwitcher />);
      fireEvent.click(screen.getByText('select span-b'));

      // Back/Forward restores the URL first; the trace prop follows a render later.
      window.history.pushState(
        null,
        '',
        `/search?eventRowWhere=${encodeURIComponent(
          JSON.stringify({
            id: 'span-x',
            type: SourceKind.Trace,
            aliasWith: [],
            traceId: 'trace-456',
          }),
        )}`,
      );
      fireEvent.popState(window);
      fireEvent.click(screen.getByText('switch'));

      expect(screen.getByTestId('overview-row-id')).toHaveTextContent('span-x');
      expect(mockSetEventRowWhere).not.toHaveBeenCalledWith(null);
      window.history.pushState(null, '', '/search');
    });

    it('writes a span clicked after a trace change to the URL', () => {
      const TraceSwitcher = () => {
        const [traceId, setTraceId] = React.useState('trace-123');
        return (
          <>
            <button onClick={() => setTraceId('trace-456')}>switch</button>
            <DBTracePanel
              traceId={traceId}
              parentSourceId="trace-source"
              childSourceId="log-source"
              dateRange={[new Date(0), new Date(1000)]}
              focusDate={new Date(500)}
            />
          </>
        );
      };
      renderWithMantine(<TraceSwitcher />);
      fireEvent.click(screen.getByText('select span-b'));
      fireEvent.click(screen.getByText('switch'));

      fireEvent.click(screen.getByText('select span-a'));

      expect(mockSetEventRowWhere).toHaveBeenLastCalledWith(
        expect.objectContaining({ id: 'span-a', traceId: 'trace-456' }),
      );
    });

    it('follows the URL on a real back/forward navigation', () => {
      renderPanel();
      fireEvent.click(screen.getByText('select span-b'));

      window.history.pushState(
        null,
        '',
        `/search?eventRowWhere=${encodeURIComponent(
          JSON.stringify({
            id: 'span-a',
            type: SourceKind.Trace,
            aliasWith: [],
            traceId: 'trace-123',
          }),
        )}`,
      );
      fireEvent.popState(window);

      expect(screen.getByTestId('overview-row-id')).toHaveTextContent('span-a');
      window.history.pushState(null, '', '/search');
    });

    it.each([
      ['no selection', '/search'],
      ['a malformed selection', '/search?eventRowWhere=%7Bnot-json'],
    ])('closes on back/forward to a URL with %s', (_, url) => {
      renderPanel();
      fireEvent.click(screen.getByText('select span-b'));

      window.history.pushState(null, '', url);
      fireEvent.popState(window);

      expect(screen.queryByTestId('overview-row-id')).not.toBeInTheDocument();
      window.history.pushState(null, '', '/search');
    });
  });

  // The searched source is the trace source; the selected waterfall event may
  // belong to the correlated log source. Search urls must target the event's
  // own source, and filter actions (which mutate the searched source's query)
  // must be gated off for cross-source events.
  describe('span detail context for the selected event', () => {
    const renderWithSearchContext = () => {
      const generateSearchUrl = jest.fn(() => '/search?mock');
      const onPropertyAddClick = jest.fn();
      renderWithMantine(
        <RowSidePanelContext
          value={{
            generateSearchUrl,
            onPropertyAddClick,
            source: mockSources['trace-source'],
          }}
        >
          <DBTracePanel
            traceId="trace-123"
            parentSourceId="trace-source"
            childSourceId="log-source"
            dateRange={[new Date(0), new Date(1000)]}
            focusDate={new Date(500)}
          />
        </RowSidePanelContext>,
      );
      return { generateSearchUrl, onPropertyAddClick };
    };

    it('targets the log source for a selected log event and gates filter actions', () => {
      mockEventRowWhere = {
        id: 'log-1',
        type: SourceKind.Log,
        aliasWith: [],
        traceId: 'trace-123',
      };
      const { generateSearchUrl } = renderWithSearchContext();

      fireEvent.click(screen.getByText('generate search url'));
      expect(generateSearchUrl).toHaveBeenCalledWith({
        where: 'x',
        whereLanguage: 'sql',
        source: expect.objectContaining({ id: 'log-source' }),
      });

      // "Add to Filters" would inject log columns into the trace search.
      expect(screen.getByTestId('can-add-to-filters')).toHaveTextContent('no');
    });

    it('keeps the searched source and filter actions for a selected span', () => {
      mockEventRowWhere = {
        id: 'span-1',
        type: SourceKind.Trace,
        aliasWith: [],
        traceId: 'trace-123',
      };
      const { generateSearchUrl } = renderWithSearchContext();

      fireEvent.click(screen.getByText('generate search url'));
      expect(generateSearchUrl).toHaveBeenCalledWith({
        where: 'x',
        whereLanguage: 'sql',
        source: expect.objectContaining({ id: 'trace-source' }),
      });

      expect(screen.getByTestId('can-add-to-filters')).toHaveTextContent('yes');
    });
  });
});
