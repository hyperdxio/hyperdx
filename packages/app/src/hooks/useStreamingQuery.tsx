import {
  QueryClient,
  QueryKey,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';

// Chunks can arrive many times a second across several concurrent hooks, so
// publishing every one means a re-render per chunk per hook.
const DEFAULT_FLUSH_INTERVAL_MS = 100;

type StreamFactory<TItem> = (args: {
  signal?: AbortSignal;
}) => AsyncIterable<TItem[]>;

type PublishPartialResult<TItem> = (getItems: () => TItem[]) => void;

/**
 * Runs a queryFn body that can publish its partial result to the query's cache
 * entry while it is still running, and returns the body's final result.
 *
 * Works because React Query notifies observers on `setQueryData` even while the
 * query is in flight; the queryFn's return value then overwrites the last
 * partial write, so the cached value ends up complete.
 *
 * The first `publish` writes at once. Later ones within `flushIntervalMs` of a
 * write are written together when that interval ends, so every result shows
 * up within `flushIntervalMs` of being published.
 *
 * Partial results only fill an empty view. If an observer is already showing
 * data (a refetch's previous result, or another query's kept by
 * `keepPreviousData`), it keeps it until the result is complete, rather than
 * blanking every item that hasn't arrived yet.
 */
export async function withPartialResults<TItem>(
  {
    queryClient,
    queryKey,
    signal,
    flushIntervalMs = DEFAULT_FLUSH_INTERVAL_MS,
  }: {
    queryClient: QueryClient;
    queryKey: QueryKey;
    signal: AbortSignal;
    flushIntervalMs?: number;
  },
  run: (publish: PublishPartialResult<TItem>) => Promise<TItem[]>,
): Promise<TItem[]> {
  const isShowingData = queryClient
    .getQueryCache()
    .find({ queryKey, exact: true })
    ?.observers.some(observer => {
      const { data, isError } = observer.getCurrentResult();
      // A failed stream's partial data is cached but not shown.
      return data !== undefined && !isError;
    });
  if (isShowingData) return run(() => {});

  let lastFlushedAt = -Infinity;
  let pendingFlush: ReturnType<typeof setTimeout> | undefined;
  let getItemsToWrite = (): TItem[] => [];

  const flush = () => {
    pendingFlush = undefined;
    // A superseded query is reverted to its pre-fetch state on cancel. A write
    // after that would cache a partial result as if it were complete.
    if (signal.aborted) return;
    lastFlushedAt = performance.now();
    queryClient.setQueryData<TItem[]>(queryKey, getItemsToWrite());
  };

  const publish: PublishPartialResult<TItem> = getItems => {
    getItemsToWrite = getItems;
    if (pendingFlush !== undefined) return;
    // Monotonic clock: this only ever measures an elapsed interval.
    const wait = lastFlushedAt + flushIntervalMs - performance.now();
    if (wait <= 0) flush();
    else pendingFlush = setTimeout(flush, wait);
  };

  try {
    return await run(publish);
  } finally {
    // The final result supersedes a write still waiting on the interval.
    clearTimeout(pendingFlush);
  }
}

/**
 * Runs an async-iterable query and exposes its results as they arrive. Use
 * only for a list that is useful before it is whole — otherwise plain
 * `useQuery` is cheaper.
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
    queryFn: ({ signal }) =>
      withPartialResults<TItem>(
        { queryClient, queryKey, signal, flushIntervalMs },
        async publish => {
          const accumulated: TItem[] = [];
          for await (const chunk of streamFactory({ signal })) {
            if (signal.aborted) break;
            accumulated.push(...chunk);
            publish(() => [...accumulated]);
          }
          return accumulated;
        },
      ),
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
