import React from 'react';
import { act, fireEvent, renderHook, screen } from '@testing-library/react';

import { SearchNumRows, useSearchTelemetry } from '@/DBSearchPage';

jest.mock('@/layout', () => ({
  withAppNav: (component: unknown) => component,
}));

const mockAddAction = jest.fn();
jest.mock('@hyperdx/browser', () => ({
  __esModule: true,
  default: { addAction: (...args: unknown[]) => mockAddAction(...args) },
}));

let mockExplainData: unknown[] | undefined = undefined;
let mockExplainIsLoading = false;
let mockExplainError: Error | null = null;

jest.mock('@/hooks/useExplainQuery', () => ({
  useExplainQuery: () => ({
    data: mockExplainData,
    isLoading: mockExplainIsLoading,
    error: mockExplainError,
  }),
}));

// Capture the last rendered config so we can assert on it without fighting portals
let lastSQLPreviewConfig: unknown = undefined;
jest.mock('../components/ChartSQLPreview', () => ({
  __esModule: true,
  default: (props: { config: unknown }) => {
    lastSQLPreviewConfig = props.config;
    return <div data-testid="chart-sql-preview" />;
  },
  SQLPreview: () => <div data-testid="sql-preview" />,
}));

// Render Mantine Modal content inline (no portal / no transition) so jsdom can see it
jest.mock('@mantine/core', () => {
  const actual = jest.requireActual('@mantine/core');
  return {
    ...actual,
    Modal: ({ opened, onClose, title, children }: any) =>
      opened ? (
        <div data-testid="modal">
          <span data-testid="modal-title">{title}</span>
          <button onClick={onClose}>close</button>
          {children}
        </div>
      ) : null,
  };
});

// ---------------------------------------------------------------------------
// useSearchTelemetry
// ---------------------------------------------------------------------------

describe('useSearchTelemetry', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('emits "search executed" action with latency_ms and source_id when a search completes', async () => {
    const { result, rerender } = renderHook(
      ({ isAnyQueryFetching, isLive, sourceId }) =>
        useSearchTelemetry({ isAnyQueryFetching, isLive, sourceId }),
      {
        initialProps: {
          isAnyQueryFetching: true,
          isLive: false,
          sourceId: 'my-source',
        },
      },
    );

    await act(async () => {
      rerender({
        isAnyQueryFetching: false,
        isLive: false,
        sourceId: 'my-source',
      });
    });

    expect(result.current.searchElapsedMs).toBeGreaterThanOrEqual(0);
    expect(mockAddAction).toHaveBeenCalledTimes(1);
    expect(mockAddAction).toHaveBeenCalledWith('search executed', {
      latency_ms: expect.any(Number),
      source_id: 'my-source',
    });
  });

  it('does NOT re-emit when sourceId changes after a completed search (P0 fix)', async () => {
    const { rerender } = renderHook(
      ({ isAnyQueryFetching, isLive, sourceId }) =>
        useSearchTelemetry({ isAnyQueryFetching, isLive, sourceId }),
      {
        initialProps: {
          isAnyQueryFetching: true,
          isLive: false,
          sourceId: 'src-a',
        },
      },
    );

    // Complete the search
    await act(async () => {
      rerender({ isAnyQueryFetching: false, isLive: false, sourceId: 'src-a' });
    });

    expect(mockAddAction).toHaveBeenCalledTimes(1);
    expect(mockAddAction).toHaveBeenCalledWith('search executed', {
      latency_ms: expect.any(Number),
      source_id: 'src-a',
    });

    // Change sourceId after search is done — must NOT fire again
    await act(async () => {
      rerender({ isAnyQueryFetching: false, isLive: false, sourceId: 'src-b' });
    });

    expect(mockAddAction).toHaveBeenCalledTimes(1); // still just 1
  });

  it('does NOT emit during live-tail ticks (P0 fix)', async () => {
    const { rerender } = renderHook(
      ({ isAnyQueryFetching, isLive, sourceId }) =>
        useSearchTelemetry({ isAnyQueryFetching, isLive, sourceId }),
      {
        initialProps: {
          isAnyQueryFetching: true,
          isLive: true,
          sourceId: 'src',
        },
      },
    );

    // Live-tail cycle completes
    await act(async () => {
      rerender({ isAnyQueryFetching: false, isLive: true, sourceId: 'src' });
    });

    expect(mockAddAction).not.toHaveBeenCalled();
  });

  it('measures elapsed time during live tail for display but does NOT emit', async () => {
    const { result, rerender } = renderHook(
      ({ isAnyQueryFetching, isLive, sourceId }) =>
        useSearchTelemetry({ isAnyQueryFetching, isLive, sourceId }),
      {
        initialProps: {
          isAnyQueryFetching: true,
          isLive: true,
          sourceId: 'src',
        },
      },
    );

    await act(async () => {
      rerender({ isAnyQueryFetching: false, isLive: true, sourceId: 'src' });
    });

    // Latency is surfaced for display ...
    expect(result.current.searchElapsedMs).toBeGreaterThanOrEqual(0);
    // ... but live-tail cycles are never reported to telemetry.
    expect(mockAddAction).not.toHaveBeenCalled();
  });

  it('keeps the previous elapsed value when a live-tail poll starts (no blink)', async () => {
    const { result, rerender } = renderHook(
      ({ isAnyQueryFetching, isLive, sourceId }) =>
        useSearchTelemetry({ isAnyQueryFetching, isLive, sourceId }),
      {
        initialProps: {
          isAnyQueryFetching: true,
          isLive: true,
          sourceId: 'src',
        },
      },
    );

    await act(async () => {
      rerender({ isAnyQueryFetching: false, isLive: true, sourceId: 'src' });
    });
    const firstElapsed = result.current.searchElapsedMs;
    expect(firstElapsed).toBeGreaterThanOrEqual(0);

    // Next poll begins — the displayed value must NOT reset to null, otherwise
    // the timer would flicker between live-tail refreshes.
    await act(async () => {
      rerender({ isAnyQueryFetching: true, isLive: true, sourceId: 'src' });
    });
    expect(result.current.searchElapsedMs).toBe(firstElapsed);
  });

  it('does NOT re-stamp the start clock if isAnyQueryFetching is already true (P2 fix)', async () => {
    const { result, rerender } = renderHook(
      ({ isAnyQueryFetching, isLive, sourceId }) =>
        useSearchTelemetry({ isAnyQueryFetching, isLive, sourceId }),
      {
        initialProps: {
          isAnyQueryFetching: true,
          isLive: false,
          sourceId: 'src',
        },
      },
    );

    // Queries temporarily dip to 0 then back up before true completion
    await act(async () => {
      rerender({ isAnyQueryFetching: false, isLive: false, sourceId: 'src' });
    });
    const firstElapsed = result.current.searchElapsedMs;

    await act(async () => {
      rerender({ isAnyQueryFetching: true, isLive: false, sourceId: 'src' });
    });
    // completedSearch is reset to null while re-fetching
    expect(result.current.searchElapsedMs).toBeNull();

    await act(async () => {
      rerender({ isAnyQueryFetching: false, isLive: false, sourceId: 'src' });
    });

    // Two emits (one per false transition) — the clock was re-anchored
    // only on the first genuine false→true, so elapsed on both are valid numbers
    expect(mockAddAction).toHaveBeenCalledTimes(2);
    expect(firstElapsed).toBeGreaterThanOrEqual(0);
    expect(result.current.searchElapsedMs).toBeGreaterThanOrEqual(0);
  });

  it('resets elapsed time and does not emit when a new search starts', async () => {
    const { result, rerender } = renderHook(
      ({ isAnyQueryFetching, isLive, sourceId }) =>
        useSearchTelemetry({ isAnyQueryFetching, isLive, sourceId }),
      {
        initialProps: {
          isAnyQueryFetching: false,
          isLive: false,
          sourceId: 'src',
        },
      },
    );

    await act(async () => {
      rerender({ isAnyQueryFetching: true, isLive: false, sourceId: 'src' });
    });

    expect(result.current.searchElapsedMs).toBeNull();
    expect(mockAddAction).not.toHaveBeenCalled();
  });

  it('falls back to empty string source_id when sourceId is null', async () => {
    const { rerender } = renderHook(
      ({ isAnyQueryFetching, isLive, sourceId }) =>
        useSearchTelemetry({ isAnyQueryFetching, isLive, sourceId }),
      {
        initialProps: {
          isAnyQueryFetching: true,
          isLive: false,
          sourceId: null as string | null,
        },
      },
    );

    await act(async () => {
      rerender({ isAnyQueryFetching: false, isLive: false, sourceId: null });
    });

    expect(mockAddAction).toHaveBeenCalledWith('search executed', {
      latency_ms: expect.any(Number),
      source_id: '',
    });
  });

  it('does not emit when fetching stops without a prior start', async () => {
    const { rerender } = renderHook(
      ({ isAnyQueryFetching, isLive, sourceId }) =>
        useSearchTelemetry({ isAnyQueryFetching, isLive, sourceId }),
      {
        initialProps: {
          isAnyQueryFetching: false,
          isLive: false,
          sourceId: 'src',
        },
      },
    );

    await act(async () => {
      rerender({ isAnyQueryFetching: false, isLive: false, sourceId: 'src' });
    });

    expect(mockAddAction).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// SearchNumRows
// ---------------------------------------------------------------------------

const baseConfig = {
  source: 'test-source',
  dateRange: { from: new Date('2024-01-01'), to: new Date('2024-01-02') },
} as any;

describe('SearchNumRows', () => {
  beforeEach(() => {
    mockExplainData = undefined;
    mockExplainIsLoading = false;
    mockExplainError = null;
  });

  it('renders nothing when enabled=false', () => {
    renderWithMantine(
      <SearchNumRows
        config={baseConfig}
        enabled={false}
        searchElapsedMs={null}
        isSearching={false}
      />,
    );
    expect(screen.queryByText(/Scanned Rows/)).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /show generated sql/i }),
    ).not.toBeInTheDocument();
  });

  it('shows loading state while explain query is in flight', () => {
    mockExplainIsLoading = true;
    renderWithMantine(
      <SearchNumRows
        config={baseConfig}
        enabled
        searchElapsedMs={null}
        isSearching={false}
      />,
    );
    expect(screen.getByText('Scanned Rows ...')).toBeInTheDocument();
  });

  it('keeps the SQL icon visible while explain is loading (no flicker on poll)', () => {
    mockExplainIsLoading = true;
    renderWithMantine(
      <SearchNumRows
        config={baseConfig}
        enabled
        searchElapsedMs={null}
        isSearching={false}
      />,
    );
    expect(
      screen.getByRole('button', { name: /show generated sql/i }),
    ).toBeInTheDocument();
  });

  it('renders empty text on error', () => {
    mockExplainError = new Error('fail');
    renderWithMantine(
      <SearchNumRows
        config={baseConfig}
        enabled
        searchElapsedMs={null}
        isSearching={false}
      />,
    );
    // No row count text shown on error
    expect(screen.queryByText(/Scanned Rows:/)).not.toBeInTheDocument();
  });

  it('shows formatted scanned row count when data is present', () => {
    mockExplainData = [{ rows: 1482447 }];
    renderWithMantine(
      <SearchNumRows
        config={baseConfig}
        enabled
        searchElapsedMs={null}
        isSearching={false}
      />,
    );
    expect(screen.getByText('Scanned Rows: 1,482,447')).toBeInTheDocument();
  });

  it('shows "Elapsed Time: ..." while searching', () => {
    mockExplainData = [{ rows: 100 }];
    renderWithMantine(
      <SearchNumRows
        config={baseConfig}
        enabled
        searchElapsedMs={null}
        isSearching
      />,
    );
    expect(screen.getByText('Elapsed Time: ...')).toBeInTheDocument();
  });

  it('does not flash the "..." elapsed loading state during live tail', () => {
    mockExplainData = [{ rows: 100 }];
    renderWithMantine(
      <SearchNumRows
        config={baseConfig}
        enabled
        searchElapsedMs={342}
        isSearching
        isLiveTail
      />,
    );
    // While live and fetching, keep showing the last value, not the "..."
    expect(screen.queryByText('Elapsed Time: ...')).not.toBeInTheDocument();
    expect(screen.getByText(/Elapsed Time:/)).toBeInTheDocument();
  });

  it('hides elapsed during live tail before the first measurement', () => {
    mockExplainData = [{ rows: 100 }];
    renderWithMantine(
      <SearchNumRows
        config={baseConfig}
        enabled
        searchElapsedMs={null}
        isSearching
        isLiveTail
      />,
    );
    expect(screen.queryByText(/Elapsed Time:/)).not.toBeInTheDocument();
  });

  it('shows formatted elapsed time after search completes', () => {
    mockExplainData = [{ rows: 100 }];
    renderWithMantine(
      <SearchNumRows
        config={baseConfig}
        enabled
        searchElapsedMs={342}
        isSearching={false}
      />,
    );
    expect(screen.getByText(/Elapsed Time:/)).toBeInTheDocument();
    expect(screen.queryByText('Elapsed Time: ...')).not.toBeInTheDocument();
  });

  it('hides elapsed time section when there is no elapsed value and not searching', () => {
    mockExplainData = [{ rows: 100 }];
    renderWithMantine(
      <SearchNumRows
        config={baseConfig}
        enabled
        searchElapsedMs={null}
        isSearching={false}
      />,
    );
    expect(screen.queryByText(/Elapsed Time:/)).not.toBeInTheDocument();
  });

  it('still shows elapsed time and SQL icon when the explain query fails', () => {
    mockExplainError = new Error('explain timed out');
    renderWithMantine(
      <SearchNumRows
        config={baseConfig}
        enabled
        searchElapsedMs={200}
        isSearching={false}
      />,
    );
    // Elapsed time is independent of the explain query and must remain visible
    expect(screen.getByText(/Elapsed Time:/)).toBeInTheDocument();
    // SQL preview is also independent of explain data
    expect(
      screen.getByRole('button', { name: /show generated sql/i }),
    ).toBeInTheDocument();
  });

  it('shows elapsed time while searching even when explain has no data yet', () => {
    mockExplainData = undefined;
    renderWithMantine(
      <SearchNumRows
        config={baseConfig}
        enabled
        searchElapsedMs={null}
        isSearching
      />,
    );
    expect(screen.getByText('Elapsed Time: ...')).toBeInTheDocument();
  });

  it('opens the modal when the SQL button is clicked', async () => {
    mockExplainData = [{ rows: 50 }];
    renderWithMantine(
      <SearchNumRows
        config={baseConfig}
        enabled
        searchElapsedMs={null}
        isSearching={false}
      />,
    );

    await act(async () => {
      fireEvent.click(
        screen.getByRole('button', { name: /show generated sql/i }),
      );
    });

    expect(screen.getByTestId('modal')).toBeInTheDocument();
    expect(screen.getByTestId('chart-sql-preview')).toBeInTheDocument();
  });

  it('uses sqlConfig in the modal when provided — title says "Timeline" and content uses sqlConfig', async () => {
    mockExplainData = [{ rows: 50 }];
    const sqlConfig = { ...baseConfig, source: 'timeline-source' } as any;

    renderWithMantine(
      <SearchNumRows
        config={baseConfig}
        sqlConfig={sqlConfig}
        enabled
        searchElapsedMs={null}
        isSearching={false}
      />,
    );

    await act(async () => {
      fireEvent.click(
        screen.getByRole('button', { name: /show generated sql/i }),
      );
    });

    expect(screen.getByTestId('modal-title')).toHaveTextContent(
      'Generated SQL (Timeline)',
    );
    expect(lastSQLPreviewConfig).toEqual(sqlConfig);
  });

  it('uses plain "Generated SQL" title and rows config when no sqlConfig is passed', async () => {
    mockExplainData = [{ rows: 50 }];
    const rowsConfig = { ...baseConfig, source: 'rows-source' } as any;

    renderWithMantine(
      <SearchNumRows
        config={rowsConfig}
        enabled
        searchElapsedMs={null}
        isSearching={false}
      />,
    );

    await act(async () => {
      fireEvent.click(
        screen.getByRole('button', { name: /show generated sql/i }),
      );
    });

    expect(screen.getByTestId('modal-title')).toHaveTextContent(
      'Generated SQL',
    );
    expect(
      screen.queryByText('Generated SQL (Timeline)'),
    ).not.toBeInTheDocument();
    expect(lastSQLPreviewConfig).toEqual(rowsConfig);
  });
});
