import { useMemo, useState } from 'react';
import { QueryKey, useQuery, useQueryClient } from '@tanstack/react-query';

// Chunks can arrive many times a second across several concurrent hooks, so
// publishing every one means a re-render per chunk per hook.
const DEFAULT_FLUSH_INTERVAL_MS = 100;

type StreamFactory<TItem> = (args: {
  signal?: AbortSignal;
}) => AsyncIterable<TItem[]>;

/**
 * Swaps the items that have arrived into the last complete result, in place,
 * and appends the ones it lacks.
 */
function overlayItems<TItem>(
  settled: TItem[],
  partial: TItem[],
  itemKey: (item: TItem) => string,
): TItem[] {
  const arrived = new Map(partial.map(item => [itemKey(item), item] as const));
  const settledKeys = new Set(settled.map(itemKey));
  return [
    ...settled.map(item => arrived.get(itemKey(item)) ?? item),
    ...partial.filter(item => !settledKeys.has(itemKey(item))),
  ];
}

/**
 * Runs an async-iterable query and exposes its results as they arrive.
 *
 * Works because React Query notifies observers on `setQueryData` even while the
 * query is in flight; the queryFn's return value then overwrites the last
 * partial write, so the cached value ends up complete. Use only for a list that
 * is useful before it is whole — otherwise plain `useQuery` is cheaper.
 */
export function useStreamingQuery<TItem>({
  queryKey,
  streamFactory,
  enabled = true,
  flushIntervalMs = DEFAULT_FLUSH_INTERVAL_MS,
  itemKey,
}: {
  queryKey: QueryKey;
  streamFactory: StreamFactory<TItem>;
  enabled?: boolean;
  flushIntervalMs?: number;
  /**
   * Identifies an item across results. When set, a stream that hasn't
   * finished is shown over the last complete result rather than from empty:
   * arrived items replace their old versions in place, and old items the new
   * result lacks drop out once it completes. Must be referentially stable.
   */
  itemKey?: (item: TItem) => string;
}) {
  const queryClient = useQueryClient();

  const query = useQuery<TItem[], Error>({
    queryKey,
    queryFn: async ({ signal }) => {
      const accumulated: TItem[] = [];
      let lastFlushedAt = 0;

      for await (const chunk of streamFactory({ signal })) {
        // A superseded query is reverted to its pre-fetch state on cancel. A
        // write after that would land a partial result in the cache as if it
        // were complete, and `staleTime: Infinity` would serve it forever.
        if (signal.aborted) break;
        accumulated.push(...chunk);
        // Monotonic clock: this only ever measures an elapsed interval.
        if (performance.now() - lastFlushedAt >= flushIntervalMs) {
          lastFlushedAt = performance.now();
          queryClient.setQueryData<TItem[]>(queryKey, [...accumulated]);
        }
      }

      return accumulated;
    },
    enabled,
    // A half-written entry must not be refetchable, and a focus refetch would
    // restart the stream mid-interaction.
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    // Deep-compares the whole growing array on every flush otherwise.
    structuralSharing: false,
    retry: false,
  });

  const [settled, setSettled] = useState<TItem[]>();
  if (
    itemKey &&
    query.isSuccess &&
    !query.isFetching &&
    query.data !== settled
  ) {
    setSettled(query.data);
  }

  const data = useMemo(() => {
    // Partial while streaming. Suppressed on error rather than handing back a
    // truncated list as though it were complete — the arrived chunks are still
    // in the cache, and `setQueryData(key, undefined)` is a no-op.
    if (query.isError) return undefined;
    if (!itemKey || !settled || !query.isFetching) return query.data;
    return overlayItems(settled, query.data ?? [], itemKey);
  }, [query.isError, query.isFetching, query.data, settled, itemKey]);

  return {
    data,
    isStreaming: query.isFetching,
    isError: query.isError,
    error: query.error,
  };
}
