import {
  useQuery,
  useQueryClient,
  UseQueryOptions,
} from '@tanstack/react-query';

// Chunks can arrive many times a second across several concurrent hooks, so
// publishing every one means a re-render per chunk per hook.
const DEFAULT_FLUSH_INTERVAL_MS = 100;

type StreamFactory<TItem> = (args: {
  signal?: AbortSignal;
}) => AsyncIterable<TItem[]>;

/**
 * Yields every stream's chunks in arrival order. A stream that fails drops
 * out and the rest carry on; the merge throws the first stream's error only
 * when every stream fails.
 */
export async function* mergeStreams<T>(
  streams: AsyncIterable<T>[],
): AsyncGenerator<T, void, undefined> {
  const iterators = streams.map(stream => stream[Symbol.asyncIterator]());
  const pull = (i: number) =>
    iterators[i].next().then(
      result => ({ i, result }),
      (error: unknown) => ({ i, error }),
    );
  const pending = new Map(iterators.map((_, i) => [i, pull(i)]));
  const errors = new Map<number, unknown>();

  try {
    while (pending.size > 0) {
      const settled = await Promise.race(pending.values());
      if ('error' in settled) {
        errors.set(settled.i, settled.error);
        pending.delete(settled.i);
      } else if (settled.result.done) {
        pending.delete(settled.i);
      } else {
        pending.set(settled.i, pull(settled.i));
        yield settled.result.value;
      }
    }
  } finally {
    // An early exit leaves the rest mid-stream; let them clean up.
    for (const i of pending.keys()) void iterators[i].return?.();
  }

  if (iterators.length > 0 && errors.size === iterators.length) {
    throw errors.get(0);
  }
}

/**
 * Runs an async-iterable query and exposes its results as they arrive.
 *
 * Works because React Query notifies observers on `setQueryData` even while the
 * query is in flight; the queryFn's return value then overwrites the last
 * partial write, so the cached value ends up complete. Use only for a list that
 * is useful before it is whole — otherwise plain `useQuery` is cheaper.
 *
 * The first chunk is written at once. Later ones within `flushIntervalMs` of a
 * write are written together when that interval ends.
 *
 * Partial results only fill an empty view. If the query is already showing
 * data (a refetch's previous result, or another query's kept by
 * `keepPreviousData`), it keeps it until the result is complete, rather than
 * blanking every item that hasn't arrived yet.
 */
export function useStreamingQuery<TItem>({
  queryKey,
  streamFactory,
  flushIntervalMs = DEFAULT_FLUSH_INTERVAL_MS,
  ...options
}: {
  streamFactory: StreamFactory<TItem>;
  flushIntervalMs?: number;
} & Omit<UseQueryOptions<TItem[], Error>, 'queryFn'>) {
  const queryClient = useQueryClient();

  const query = useQuery<TItem[], Error>({
    queryKey,
    queryFn: async ({ signal }) => {
      const isShowingData = queryClient
        .getQueryCache()
        .find({ queryKey, exact: true })
        ?.observers.some(observer => {
          const { data, isError } = observer.getCurrentResult();
          // A failed stream's partial data is cached but not shown.
          return data !== undefined && !isError;
        });

      const accumulated: TItem[] = [];
      let lastFlushedAt = -Infinity;
      let pendingFlush: ReturnType<typeof setTimeout> | undefined;
      const flush = () => {
        pendingFlush = undefined;
        // A superseded query is reverted to its pre-fetch state on cancel. A
        // write after that would cache a partial result as if it were
        // complete.
        if (signal.aborted) return;
        lastFlushedAt = performance.now();
        queryClient.setQueryData<TItem[]>(queryKey, [...accumulated]);
      };

      // Since React Query 5.85, a cancelled fetch reverts to its last
      // `setQueryData` write instead of its pre-fetch state, which would cache
      // a superseded stream's partial result as complete.
      const cachedQuery = queryClient
        .getQueryCache()
        .find({ queryKey, exact: true });
      const stateBeforeStream = cachedQuery?.state;
      signal.addEventListener('abort', () => {
        if (stateBeforeStream && lastFlushedAt > -Infinity) {
          cachedQuery?.setState({ ...stateBeforeStream, fetchStatus: 'idle' });
        }
      });

      try {
        for await (const chunk of streamFactory({ signal })) {
          if (signal.aborted) break;
          accumulated.push(...chunk);
          if (isShowingData || pendingFlush !== undefined) continue;
          // Monotonic clock: this only ever measures an elapsed interval.
          const wait = lastFlushedAt + flushIntervalMs - performance.now();
          if (wait <= 0) flush();
          else pendingFlush = setTimeout(flush, wait);
        }
        return accumulated;
      } finally {
        // The final result supersedes a write still waiting on the interval.
        clearTimeout(pendingFlush);
      }
    },
    // A half-written entry must not be refetchable, and a focus refetch would
    // restart the stream mid-interaction.
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    // Deep-compares the whole growing array on every flush otherwise.
    structuralSharing: false,
    retry: false,
    ...options,
  });

  return {
    ...query,
    // Partial while streaming. Suppressed on error rather than handing back a
    // truncated list as though it were complete — the arrived chunks are still
    // in the cache, and `setQueryData(key, undefined)` is a no-op.
    data: query.isError ? undefined : query.data,
    isStreaming: query.isFetching,
  };
}
