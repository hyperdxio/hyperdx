import { useMemo } from 'react';

import api from './api';

export function useSessionEvents({
  config: { where, dateRange },
}: {
  config: {
    where: string;
    dateRange: [Date, Date];
  };
}) {
  const {
    status,
    data: searchResultsPages,
    error,
    isFetching,
    isFetchingNextPage,
    isFetchingPreviousPage,
    fetchNextPage,
    fetchPreviousPage,
    hasNextPage,
    hasPreviousPage,
  } = api.useLogBatch(
    {
      q: where,
      startDate: dateRange?.[0] ?? new Date(),
      endDate: dateRange?.[1] ?? new Date(),
      extraFields: [
        'end_timestamp',
        'trace_id',
        'span_id',
        'parent_span_id',
        'http.status_code',
        'http.method',
        'http.url',
        'error.message',
        'location.href',
        'span_name',
        'component',
        'otel.library.name',
        'exception.group_id',
      ],
      order: null,
      limit: 4000,
    },
    {
      // mikeshi: Eliminates a memory leak in the DOM Player (not sure why)
      cacheTime: 0,
      refetchOnWindowFocus: false,
      getNextPageParam: (lastPage: any, allPages) => {
        if (lastPage.rows === 0) return undefined;
        return allPages.flatMap(page => page.data).length;
      },
    },
  );

  const events = useMemo(() => {
    return searchResultsPages?.pages
      .flatMap(page => page.data)
      .map(result => {
        return {
          ...result,
          startOffset: new Date(result.timestamp).getTime(),
          endOffset: new Date(result.end_timestamp).getTime(),
          // startOffset: isoToNsOffset(result.timestamp),
          // endOffset: isoToNsOffset(result.end_timestamp),
        };
      })
      .sort((a, b) => parseInt(a.sort_key) - parseInt(b.sort_key));
  }, [searchResultsPages]);

  return {
    events,
    isFetching,
  };
}
