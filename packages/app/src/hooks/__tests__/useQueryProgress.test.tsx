import * as React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';

import {
  clearQueryProgress,
  completeChunkProgress,
  useQueryProgress,
  writeChunkProgress,
} from '@/hooks/useQueryProgress';

const QUERY_KEY = ['search', 'abc'] as const;
const ONE_HOUR_MS = 60 * 60 * 1000;

function progressEvent(readRows: number, totalRows: number) {
  return {
    read_rows: String(readRows),
    read_bytes: String(readRows * 10),
    total_rows_to_read: String(totalRows),
    elapsed_ns: '1',
  };
}

describe('useQueryProgress', () => {
  let queryClient: QueryClient;
  let wrapper: React.FC<{ children: React.ReactNode }>;

  beforeEach(() => {
    jest.useFakeTimers();
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    wrapper = ({ children }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  });

  afterEach(() => {
    jest.useRealTimers();
    queryClient.clear();
  });

  function renderProgress(initialActive: boolean) {
    return renderHook(
      ({ active }: { active: boolean }) =>
        useQueryProgress({
          queryKey: QUERY_KEY,
          active,
          totalRangeMs: 4 * ONE_HOUR_MS,
        }),
      { wrapper, initialProps: { active: initialActive } },
    );
  }

  it('returns undefined until a chunk reports something', () => {
    const { result } = renderProgress(true);
    expect(result.current).toBeUndefined();
  });

  it('summarizes reported chunks against the whole range', () => {
    const { result } = renderProgress(true);

    act(() => {
      writeChunkProgress(queryClient, QUERY_KEY, {
        chunkId: 'window-0',
        rangeMs: 2 * ONE_HOUR_MS,
        progress: progressEvent(500, 1000),
      });
      jest.advanceTimersByTime(1);
    });

    // Half of a window covering half the range.
    expect(result.current?.percent).toBeCloseTo(25, 5);
    expect(result.current?.readRows).toBe(500);
  });

  it('hides progress as soon as the query stops fetching', () => {
    const { result, rerender } = renderProgress(true);

    act(() => {
      writeChunkProgress(queryClient, QUERY_KEY, {
        chunkId: 'window-0',
        rangeMs: ONE_HOUR_MS,
        progress: progressEvent(500, 1000),
      });
      jest.advanceTimersByTime(1);
    });
    expect(result.current).toBeDefined();

    rerender({ active: false });
    expect(result.current).toBeUndefined();
  });

  describe('several requests sharing one chunk', () => {
    // A time window serves its results over multiple offset pages, each its
    // own ClickHouse query reporting its own counters against the same chunk.

    it('accumulates rows instead of replacing them', () => {
      const { result, rerender } = renderProgress(true);

      act(() => {
        writeChunkProgress(queryClient, QUERY_KEY, {
          chunkId: 'window-0',
          rangeMs: ONE_HOUR_MS,
          progress: progressEvent(500, 1000),
        });
        completeChunkProgress(queryClient, QUERY_KEY, {
          chunkId: 'window-0',
          rangeMs: ONE_HOUR_MS,
          isChunkExhausted: false,
        });
        jest.advanceTimersByTime(1);
      });
      expect(result.current?.readRows).toBe(500);

      // The next offset page against the same window.
      act(() => {
        writeChunkProgress(queryClient, QUERY_KEY, {
          chunkId: 'window-0',
          rangeMs: ONE_HOUR_MS,
          progress: progressEvent(300, 1000),
        });
        jest.advanceTimersByTime(1);
      });
      rerender({ active: true });

      expect(result.current?.readRows).toBe(800);
    });

    it("withholds the chunk's full range until it is exhausted", () => {
      const { result, rerender } = renderProgress(true);

      // Half-scanned, and the page returned rows, so more offsets follow.
      act(() => {
        writeChunkProgress(queryClient, QUERY_KEY, {
          chunkId: 'window-0',
          rangeMs: 2 * ONE_HOUR_MS,
          progress: progressEvent(500, 1000),
        });
        completeChunkProgress(queryClient, QUERY_KEY, {
          chunkId: 'window-0',
          rangeMs: 2 * ONE_HOUR_MS,
          isChunkExhausted: false,
        });
        jest.advanceTimersByTime(1);
      });

      // Still only half of the 2h window across a 4h range, not all of it.
      expect(result.current?.percent).toBeCloseTo(25, 5);

      act(() => {
        completeChunkProgress(queryClient, QUERY_KEY, {
          chunkId: 'window-0',
          rangeMs: 2 * ONE_HOUR_MS,
        });
        jest.advanceTimersByTime(1);
      });
      rerender({ active: true });

      expect(result.current?.percent).toBeCloseTo(50, 5);
    });
  });

  describe('gaps between fetches', () => {
    it('keeps accumulated progress across a short gap between windows', () => {
      const { result, rerender } = renderProgress(true);

      act(() => {
        completeChunkProgress(queryClient, QUERY_KEY, {
          chunkId: 'window-0',
          rangeMs: ONE_HOUR_MS,
        });
        writeChunkProgress(queryClient, QUERY_KEY, {
          chunkId: 'window-0',
          rangeMs: ONE_HOUR_MS,
          progress: progressEvent(800, 800),
        });
      });

      // The gap between one window finishing and the next starting.
      rerender({ active: false });
      act(() => {
        jest.advanceTimersByTime(200);
      });
      rerender({ active: true });

      // Window 0 still counts towards the 4h range, and its rows are intact,
      // before the next window has reported anything.
      expect(result.current?.percent).toBeCloseTo(25, 5);
      expect(result.current?.readRows).toBe(800);
    });

    it('survives an arbitrarily long gap, since a rerun is what resets it', () => {
      const { result, rerender } = renderProgress(true);

      act(() => {
        completeChunkProgress(queryClient, QUERY_KEY, {
          chunkId: 'window-0',
          rangeMs: ONE_HOUR_MS,
        });
        jest.advanceTimersByTime(1);
      });

      // Scrolling for more results minutes later continues the same search.
      rerender({ active: false });
      act(() => {
        jest.advanceTimersByTime(10 * 60 * 1000);
      });
      rerender({ active: true });

      expect(result.current?.percent).toBeCloseTo(25, 5);
      // The whole gap is idle time, not query time.
      expect(result.current?.elapsedMs).toBeLessThan(1_000);
    });

    it('excludes the idle gap from the elapsed readout', () => {
      const { result, rerender } = renderProgress(true);

      act(() => {
        writeChunkProgress(queryClient, QUERY_KEY, {
          chunkId: 'window-0',
          rangeMs: ONE_HOUR_MS,
          progress: progressEvent(500, 1000),
        });
      });

      // 1s fetching, 1.5s idle between windows, then 1s fetching again.
      act(() => {
        jest.advanceTimersByTime(1_000);
      });
      rerender({ active: false });
      act(() => {
        jest.advanceTimersByTime(1_500);
      });
      rerender({ active: true });
      act(() => {
        jest.advanceTimersByTime(1_000);
      });

      expect(result.current?.elapsedMs).toBeGreaterThanOrEqual(2_000);
      expect(result.current?.elapsedMs).toBeLessThan(2_500);
    });
  });

  it('restarts from zero after clearQueryProgress', () => {
    const { result, rerender } = renderProgress(true);

    act(() => {
      writeChunkProgress(queryClient, QUERY_KEY, {
        chunkId: 'window-0',
        rangeMs: ONE_HOUR_MS,
        progress: progressEvent(500, 1000),
      });
      jest.advanceTimersByTime(1);
    });
    expect(result.current?.readRows).toBe(500);

    // What a rerun does: drop the previous run's totals, then report afresh.
    act(() => {
      clearQueryProgress(queryClient, QUERY_KEY);
      writeChunkProgress(queryClient, QUERY_KEY, {
        chunkId: 'window-0',
        rangeMs: ONE_HOUR_MS,
        progress: progressEvent(10, 1000),
      });
      jest.advanceTimersByTime(1);
    });
    rerender({ active: true });

    expect(result.current?.readRows).toBe(10);
  });
});
