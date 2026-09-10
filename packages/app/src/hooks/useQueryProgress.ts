import { useEffect, useMemo, useState } from 'react';
import type { ClickHouseProgress } from '@hyperdx/common-utils/dist/clickhouse';
import {
  hashKey,
  QueryClient,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';

import {
  ChunkProgress,
  QueryProgressSummary,
  summarizeChunkProgress,
  toChunkProgress,
} from '@/utils/queryProgress';

/**
 * Every timestamp here is only ever read as a difference, so this uses the
 * monotonic clock: elapsed time stays correct across a wall-clock adjustment,
 * and it sidesteps the render-stability concerns that apply to `Date.now()`.
 */
const nowMs = () => performance.now();

/** How often the elapsed-time readout advances while a query is in flight. */
const TICK_MS = 500;

type ProgressState = {
  startedAt: number;
  /** Set while the query is between fetches. */
  pausedAt?: number;
  /** Time the query spent not fetching, excluded from the elapsed readout. */
  idleMs: number;
  /**
   * Counters from requests that have finished. A chunk's own counters describe
   * only the request currently streaming it, so they are banked here when that
   * request settles — several requests can share one chunk (the offset pages
   * within a time window), and the later ones must not erase the earlier.
   */
  settledRows: number;
  settledBytes: number;
  /** Keyed by chunk id so parallel chunks can report independently. */
  chunks: Record<string, ChunkProgress>;
};

/**
 * Progress lives in its own cache entry rather than inside the query's data.
 * Writing it into the data entry would push a placeholder result on every
 * tick, which makes the table and chart flicker on refetches of an
 * already-rendered query.
 */
function progressKeyFn(queryKey: readonly unknown[]) {
  return ['query-progress', ...queryKey] as const;
}

function updateProgress(
  queryClient: QueryClient,
  queryKey: readonly unknown[],
  update: (prev: ProgressState) => ProgressState,
) {
  queryClient.setQueryData<ProgressState>(progressKeyFn(queryKey), prev =>
    update(
      prev ?? {
        startedAt: nowMs(),
        idleMs: 0,
        settledRows: 0,
        settledBytes: 0,
        chunks: {},
      },
    ),
  );
}

/**
 * Registers a chunk as in flight, before it has reported anything.
 *
 * Without this a just-started window has no entry, so `completedRanges` — which
 * is derived from the pages in the cache, including the placeholder page for
 * the window being streamed — credits its whole range. The bar would jump
 * ahead as each window opened and snap back on its first progress event.
 *
 * No-ops if the chunk is already known, so the offset pages within a window
 * cannot reset it.
 */
export function startChunkProgress(
  queryClient: QueryClient,
  queryKey: readonly unknown[],
  { chunkId, rangeMs }: { chunkId: string; rangeMs: number },
) {
  updateProgress(queryClient, queryKey, prev =>
    prev.chunks[chunkId] != null
      ? prev
      : {
          ...prev,
          chunks: {
            ...prev.chunks,
            [chunkId]: {
              rangeMs,
              readRows: 0,
              readBytes: 0,
              fraction: 0,
              isComplete: false,
            },
          },
        },
  );
}

/** Records the latest progress event for one chunk of a query. */
export function writeChunkProgress(
  queryClient: QueryClient,
  queryKey: readonly unknown[],
  {
    chunkId,
    progress,
    rangeMs,
  }: { chunkId: string; progress: ClickHouseProgress; rangeMs: number },
) {
  updateProgress(queryClient, queryKey, prev => ({
    ...prev,
    chunks: {
      ...prev.chunks,
      [chunkId]: {
        ...toChunkProgress(progress, rangeMs),
        // A chunk that already finished must not regress if a late progress
        // event for it arrives afterwards.
        isComplete: prev.chunks[chunkId]?.isComplete ?? false,
      },
    },
  }));
}

/**
 * Marks a chunk fully searched, so it contributes its whole window to the
 * covered range even when no progress event ever reported a total estimate.
 */
export function completeChunkProgress(
  queryClient: QueryClient,
  queryKey: readonly unknown[],
  {
    chunkId,
    rangeMs,
    isChunkExhausted = true,
  }: { chunkId: string; rangeMs: number; isChunkExhausted?: boolean },
) {
  updateProgress(queryClient, queryKey, prev => {
    const existing = prev.chunks[chunkId];
    return {
      ...prev,
      // Bank this request's counters, then zero the chunk's own so a follow-up
      // request against the same chunk adds to the total instead of replacing
      // it. Without this, paging deeper into a window would make the reported
      // row count drop back to whatever the newest page had read.
      settledRows: prev.settledRows + (existing?.readRows ?? 0),
      settledBytes: prev.settledBytes + (existing?.readBytes ?? 0),
      chunks: {
        ...prev.chunks,
        [chunkId]: {
          rangeMs,
          readRows: 0,
          readBytes: 0,
          // Only credit the chunk's whole range once nothing is left in it.
          // A window that still has offset pages to serve has not been fully
          // scanned, so it keeps the fraction its last progress event implied.
          fraction: isChunkExhausted ? 1 : existing?.fraction,
          isComplete: isChunkExhausted,
        },
      },
    };
  });
}

export function clearQueryProgress(
  queryClient: QueryClient,
  queryKey: readonly unknown[],
) {
  queryClient.removeQueries({ queryKey: progressKeyFn(queryKey), exact: true });
}

/**
 * Subscribes to the progress written by a query's `queryFn` and folds it into
 * a whole-query summary. Returns undefined when the query is not running or
 * has reported nothing yet.
 *
 * `completedRanges` lets a caller credit windows that finished in earlier
 * fetch cycles (e.g. pages already in the react-query cache), so the bar keeps
 * climbing across an infinite-scroll sequence instead of restarting per page.
 * It is keyed by chunk id: an entry whose chunk is currently streaming is
 * ignored, since the live chunk already accounts for that window.
 */
export function useQueryProgress({
  queryKey,
  active,
  totalRangeMs,
  completedRanges,
}: {
  queryKey: readonly unknown[];
  active: boolean;
  totalRangeMs: number;
  completedRanges?: Record<string, number>;
}): QueryProgressSummary | undefined {
  const queryClient = useQueryClient();

  const { data: state } = useQuery<ProgressState | undefined>({
    queryKey: progressKeyFn(queryKey),
    // The producing queryFn is the only writer; this never fetches.
    queryFn: () => undefined,
    enabled: false,
    gcTime: 0,
  });

  // Advance the elapsed readout between progress events, which ClickHouse
  // only emits every `interactive_delay` (100ms by default) and not at all
  // while a chunk is queued behind others.
  const [now, setNow] = useState(nowMs);
  useEffect(() => {
    if (!active || state == null) return;
    // The leading resync matters on resume: `now` last advanced before the
    // gap, and the gap has just been added to `idleMs`, so without it elapsed
    // would dip until the first interval fires.
    const resync = setTimeout(() => setNow(nowMs()), 0);
    const id = setInterval(() => setNow(nowMs()), TICK_MS);
    return () => {
      clearTimeout(resync);
      clearInterval(id);
    };
  }, [active, state]);

  // Track the gaps when the query is not fetching, so they are not billed as
  // query time.
  //
  // A paginated search walks the range one window at a time and each window is
  // a separate fetch, so `isFetching` dips between them. The entry is
  // deliberately left in place across those dips — discarding it would make the
  // bar vanish and the timer restart at every window boundary. A fresh run
  // clears the entry from its `queryFn`, so nothing stale outlives a search.
  //
  // Addressed by hash rather than by key: the caller's `queryKey` is rebuilt
  // every render, so depending on it directly would restart this effect
  // constantly.
  const progressHash = hashKey(progressKeyFn(queryKey));
  useEffect(() => {
    const query = queryClient.getQueryCache().get<ProgressState>(progressHash);
    const entry = query?.state.data;
    if (query == null || entry == null) return;

    if (active) {
      if (entry.pausedAt == null) return;
      query.setData({
        ...entry,
        pausedAt: undefined,
        idleMs: entry.idleMs + Math.max(nowMs() - entry.pausedAt, 0),
      });
      return;
    }

    if (entry.pausedAt != null) return;
    query.setData({ ...entry, pausedAt: nowMs() });
  }, [active, queryClient, progressHash]);

  return useMemo(() => {
    if (!active || state == null) return undefined;

    const completedRangeMs = Object.entries(completedRanges ?? {}).reduce(
      (sum, [chunkId, rangeMs]) =>
        state.chunks[chunkId] != null ? sum : sum + rangeMs,
      0,
    );

    return summarizeChunkProgress({
      chunks: Object.values(state.chunks),
      totalRangeMs,
      completedRangeMs,
      completedRows: state.settledRows,
      completedBytes: state.settledBytes,
      elapsedMs: Math.max(now - state.startedAt - state.idleMs, 0),
    });
  }, [active, state, totalRangeMs, completedRanges, now]);
}
