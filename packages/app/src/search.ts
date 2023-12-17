import { useCallback, useEffect, useRef, useState } from 'react';
import { UseQueryOptions } from 'react-query';
import { fetchEventSource } from '@microsoft/fetch-event-source';

import { API_SERVER_URL } from './config';
import { usePrevious } from './utils';

let team: string | null = null;
try {
  team = localStorage?.getItem('hdx_team');
} catch (e) {
  // ignore
}
class RetriableError extends Error {}
class FatalError extends Error {}
class TimeoutError extends Error {}
const EventStreamContentType = 'text/event-stream';

function useSearchEventStream(
  {
    apiUrlPath,
    q,
    startDate,
    endDate,
    extraFields,
    order,
    limit = 100,
    onEvent,
    onEnd,
    resultsKey,
  }: {
    apiUrlPath: string;
    q: string;
    startDate: Date;
    endDate: Date;
    extraFields: string[];
    order: 'asc' | 'desc';
    limit?: number;
    onEvent?: (event: any) => void;
    onEnd?: (error?: any) => void;
    resultsKey?: string;
  },
  options?: UseQueryOptions<any, Error> & {
    shouldAbortPendingRequest?: boolean;
  },
) {
  const enabled = options?.enabled ?? true;
  const keepPreviousData = options?.keepPreviousData ?? false;
  const shouldAbortPendingRequest = options?.shouldAbortPendingRequest ?? true;

  const [results, setResults] = useState<{ key: string; data: any[] }>({
    key: '',
    data: [],
  });
  // Set isFetching to true by default
  // unless we're not enabled
  const [isFetching, setIsFetching] = useState<boolean>(enabled);
  const [hasNextPage, setHasNextPage] = useState<boolean>(true);

  const lastAbortController = useRef<AbortController | null>(null);
  const [fetchStatus, setFetchStatus] = useState<'fetching' | 'idle'>('idle');
  const lastFetchStatusRef = useRef<'fetching' | 'idle' | undefined>();

  const fetchResults = useCallback(
    async ({
      pageParam = 0,
      limit: limitOverride,
    }: {
      pageParam: number;
      limit?: number;
    }) => {
      const resBuffer: any[] = [];
      let linesFetched = 0;

      const startTime = startDate.getTime().toString();
      const endTime = endDate.getTime().toString();

      const searchParams = new URLSearchParams([
        ['endTime', endTime],
        ['q', q],
        ['startTime', startTime],
        ['order', order],
        ['offset', pageParam.toString()],
        ['limit', (limitOverride ?? limit).toString()],
        ...(team != null ? [['team', team]] : []),
        ...extraFields.map(field => ['extraFields[]', field]),
      ]);

      const ctrl = new AbortController();
      lastAbortController.current = ctrl;

      setIsFetching(true);
      setFetchStatus('fetching');
      lastFetchStatusRef.current = 'fetching';

      const fetchPromise = fetchEventSource(
        `${API_SERVER_URL}${apiUrlPath}?${searchParams.toString()}`,
        {
          method: 'GET',
          signal: ctrl.signal,
          credentials: 'include',
          async onopen(response) {
            if (
              response.ok &&
              response.headers.get('content-type') === EventStreamContentType
            ) {
              return; // everything's good
            } else if (
              response.status >= 400 &&
              response.status < 500 &&
              response.status !== 429
            ) {
              // client-side errors are usually non-retriable:
              // TODO: handle these???
              throw new FatalError();
            } else {
              throw new RetriableError();
            }
          },
          onmessage(event) {
            if (event.event === '') {
              const parsedRows = event.data
                .split('\n')
                .map((row: string) => {
                  try {
                    const parsed = JSON.parse(row);
                    linesFetched++;
                    return parsed;
                  } catch (e) {
                    return null;
                  }
                })
                .filter((v: any) => v !== null);

              if (onEvent != null) {
                parsedRows.forEach(onEvent);
              } else if (keepPreviousData) {
                resBuffer.push(...parsedRows);
              } else {
                setResults(prevResults => ({
                  key: resultsKey ?? prevResults.key ?? 'DEFAULT_KEY',
                  data: [...prevResults.data, ...parsedRows],
                }));
              }
            } else if (event.event === 'end') {
              onEnd?.();

              if (keepPreviousData) {
                setResults({
                  key: resultsKey ?? 'DEFAULT_KEY',
                  data: resBuffer,
                });
              }

              if (linesFetched === 0 || linesFetched < limit) {
                setHasNextPage(false);
              }
            }
          },
          onclose() {
            ctrl.abort();

            setIsFetching(false);
            setFetchStatus('idle');
            lastFetchStatusRef.current = 'idle';
            // if the server closes the connection unexpectedly, retry:
            // throw new RetriableError();
          },
          // onerror(err) {
          //   if (err instanceof FatalError) {
          //     throw err; // rethrow to stop the operation
          //   } else {
          //     // do nothing to automatically retry. You can also
          //     // return a specific retry interval here.
          //   }
          // },
        },
      );

      try {
        await Promise.race([
          fetchPromise,
          new Promise((_, reject) => {
            setTimeout(() => {
              reject(new TimeoutError('Timeout'));
            }, 90 * 1000);
          }),
        ]);
      } catch (e) {
        if (e instanceof TimeoutError) {
          setIsFetching(false);
          setFetchStatus('idle');
          lastFetchStatusRef.current = 'idle';
          ctrl.abort();
          console.warn('Closing event source due to timeout');
          onEnd?.(new TimeoutError());
        } else {
          console.error(e);
        }
      }
    },
    [
      apiUrlPath,
      q,
      startDate,
      endDate,
      extraFields,
      order,
      limit,
      keepPreviousData,
      setResults,
      onEvent,
      onEnd,
      resultsKey,
    ],
  );

  const queryKey = [
    apiUrlPath,
    q,
    startDate,
    endDate,
    extraFields,
    order,
    limit,
  ].join('||');
  const prevQueryKey = usePrevious(queryKey);

  useEffect(() => {
    // Only attempt fetching on new query keys
    if (prevQueryKey != queryKey && enabled) {
      if (
        lastFetchStatusRef.current !== 'fetching' ||
        shouldAbortPendingRequest
      ) {
        // Abort previous pending request
        if (
          shouldAbortPendingRequest &&
          lastFetchStatusRef.current === 'fetching'
        ) {
          lastAbortController.current?.abort();
        }

        // Clean up previous results if we shouldn't keep them
        if (!keepPreviousData) {
          setResults({ key: '', data: [] });
        }

        setHasNextPage(true);
        fetchResults({ pageParam: 0 });
      }
    }
  }, [
    prevQueryKey,
    queryKey,
    shouldAbortPendingRequest,
    fetchResults,
    keepPreviousData,
    enabled,
  ]);

  const fetchNextPage = useCallback(
    (params?: { limit?: number }) => {
      // Make sure we don't try to fetch again when we're already fetching
      // Make sure lastFetchStatusRef is not null, as that means we haven't done an initial fetch yet
      if (
        hasNextPage &&
        lastFetchStatusRef.current === 'idle' &&
        results.data.length > 0 // make sure we at least fetched initially
      ) {
        fetchResults({
          pageParam: results.data.length,
          limit: params?.limit,
        });
      }
    },
    [fetchResults, results.data.length, hasNextPage],
  );

  return {
    hasNextPage,
    isFetching,
    results: results.data,
    resultsKey: results.key,
    fetchNextPage,
  };
}

export { useSearchEventStream };
