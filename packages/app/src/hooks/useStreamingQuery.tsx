import { QueryKey, useQuery, useQueryClient } from '@tanstack/react-query';

// Chunks can arrive many times a second across several concurrent hooks, so
// publishing every one means a re-render per chunk per hook.
const DEFAULT_FLUSH_INTERVAL_MS = 100;

type StreamFactory<TItem> = (args: {
  signal?: AbortSignal;
}) => AsyncIterable<TItem[]>;

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
}: {
  queryKey: QueryKey;
  streamFactory: StreamFactory<TItem>;
  enabled?: boolean;
  flushIntervalMs?: number;
}) {
  const queryClient = useQueryClient();

  const query = useQuery<TItem[], Error>({
    queryKey,
    queryFn: async ({ signal }) => {
      const accumulated: TItem[] = [];
      let lastFlushedAt = 0;

      for await (const chunk of streamFactory({ signal })) {
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

  return {
    // Partial while streaming. Suppressed on error rather than handing back a
    // truncated list as though it were complete — the arrived chunks are still
    // in the cache, and `setQueryData(key, undefined)` is a no-op.
    data: query.isError ? undefined : query.data,
    isStreaming: query.isFetching,
    isError: query.isError,
    error: query.error,
  };
}
