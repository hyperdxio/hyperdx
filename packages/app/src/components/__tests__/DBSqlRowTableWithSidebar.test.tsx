import { BuilderChartConfigWithDateRange } from '@hyperdx/common-utils/dist/types';
import { fireEvent, screen } from '@testing-library/react';

import DBSqlRowTableWithSideBar from '@/components/DBSqlRowTableWithSidebar';

const FIRST_SPAN = "SpanId='8cea712d1d4df628'";
const OTHER_SPAN = "SpanId='b2e2b0df5304a26a'";

type StoredSpan = {
  id: string;
  type: string;
  aliasWith: unknown[];
  traceId: string;
};

const mockQuery: Record<string, unknown> = {};
const mockListeners = new Set<() => void>();

jest.mock('nuqs', () => {
  const React = jest.requireActual('react');
  const current = (key: string) =>
    Object.prototype.hasOwnProperty.call(mockQuery, key)
      ? mockQuery[key]
      : null;
  return {
    useQueryState: (key: string) => {
      const [, rerender] = React.useState(0);
      React.useEffect(() => {
        const listener = () => rerender((tick: number) => tick + 1);
        mockListeners.add(listener);
        return () => {
          mockListeners.delete(listener);
        };
      }, [rerender]);

      const setValue = React.useCallback(
        (next: unknown) => {
          const previous = current(key);
          const resolved = typeof next === 'function' ? next(previous) : next;
          if (Object.is(resolved, previous)) return;
          mockQuery[key] = resolved;
          mockListeners.forEach(listener => listener());
        },
        [key],
      );

      return [current(key), setValue];
    },
  };
});

jest.mock('@/source', () => ({
  useSource: () => ({
    data: { id: 'trace-source', kind: 'trace' },
    isLoading: false,
  }),
}));

jest.mock('../DBRowTable', () => ({
  DBSqlRowTable: ({
    onRowDetailsClick,
  }: {
    onRowDetailsClick: (row: { where: string; aliasWith: never[] }) => void;
  }) => (
    <>
      <button
        type="button"
        onClick={() =>
          onRowDetailsClick({ where: OTHER_SPAN, aliasWith: [] })
        }
      >
        open other span
      </button>
      <button
        type="button"
        onClick={() =>
          onRowDetailsClick({ where: FIRST_SPAN, aliasWith: [] })
        }
      >
        open first span
      </button>
    </>
  ),
}));

jest.mock('../DBRowSidePanel', () => {
  const React = jest.requireActual('react');
  return {
    __esModule: true,
    default: ({
      onClose,
    }: {
      onClose: () => void;
      rowId?: string;
    }) => (
      <button type="button" onClick={onClose}>
        close result
      </button>
    ),
    RowSidePanelContext: React.createContext({}),
  };
});

jest.mock('../DBRowDataPanel', () => ({
  useRowData: () => ({ isError: false, error: null }),
  RowDataPanel: () => null,
}));

jest.mock('../DBRowOverviewPanel', () => ({
  RowOverviewPanel: () => null,
}));

jest.mock('../DBRowSidePanelErrorState', () => ({
  DBRowSidePanelErrorState: () => null,
}));

const chartConfig = {
  select: [],
  where: '',
  whereLanguage: 'sql',
  dateRange: [new Date(0), new Date(1)],
} as BuilderChartConfigWithDateRange;

function span(id: string): StoredSpan {
  return {
    id,
    type: 'trace',
    aliasWith: [],
    traceId: 'trace-123',
  };
}

function renderResults() {
  renderWithMantine(
    <DBSqlRowTableWithSideBar sourceId="trace-source" config={chartConfig} />,
  );
}

describe('DBSqlRowTableWithSideBar span selection', () => {
  beforeEach(() => {
    Object.keys(mockQuery).forEach(key => {
      delete mockQuery[key];
    });
    mockListeners.clear();
  });

  it('drops the span when one result is closed and another span of the same trace is opened', () => {
    mockQuery.rowWhere = FIRST_SPAN;
    mockQuery.eventRowWhere = span(FIRST_SPAN);
    renderResults();

    expect(mockQuery.eventRowWhere).toEqual(span(FIRST_SPAN));

    fireEvent.click(screen.getByRole('button', { name: 'close result' }));
    expect(mockQuery.eventRowWhere).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'open other span' }));
    expect(mockQuery.eventRowWhere).toBeNull();
    expect(mockQuery.rowWhere).toBe(OTHER_SPAN);
  });

  it('keeps the span when the opened result is that span', () => {
    mockQuery.eventRowWhere = span(FIRST_SPAN);
    renderResults();

    fireEvent.click(screen.getByRole('button', { name: 'open first span' }));

    expect(mockQuery.eventRowWhere).toEqual(span(FIRST_SPAN));
    expect(mockQuery.rowWhere).toBe(FIRST_SPAN);
  });
});
