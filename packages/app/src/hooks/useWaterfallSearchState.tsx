import { useCallback, useState } from 'react';
import { useQueryState } from 'nuqs';

export default function useWaterfallSearchState({
  hasLogSource,
}: {
  hasLogSource?: boolean;
}) {
  const [traceWhere, setTraceWhere] = useQueryState('traceWhere');
  const [logWhere, setLogWhere] = useQueryState('logWhere');
  const [traceWhereLanguage, setTraceWhereLanguage] =
    useQueryState('traceWhereLanguage');
  const [logWhereLanguage, setLogWhereLanguage] =
    useQueryState('logWhereLanguage');

  const isFilterActive = !!traceWhere || !!(hasLogSource && logWhere);

  const [isFilterExpanded, setIsFilterExpanded] = useState(isFilterActive);

  // Only the keys present are written, so a caller that owns one of the two
  // filters (e.g. the trace Logs tab) can submit it without clearing the other.
  const onSubmit = useCallback(
    (data: {
      traceWhere?: string;
      logWhere?: string;
      traceWhereLanguage?: string;
      logWhereLanguage?: string;
    }) => {
      if (data.traceWhere !== undefined) {
        setTraceWhere(data.traceWhere || null);
      }
      if (data.logWhere !== undefined) {
        setLogWhere(data.logWhere || null);
      }
      if (data.traceWhereLanguage !== undefined) {
        setTraceWhereLanguage(data.traceWhereLanguage || null);
      }
      if (data.logWhereLanguage !== undefined) {
        setLogWhereLanguage(data.logWhereLanguage || null);
      }
    },
    [setTraceWhere, setLogWhere, setTraceWhereLanguage, setLogWhereLanguage],
  );

  const clear = useCallback(() => {
    setTraceWhere(null);
    setLogWhere(null);
    setTraceWhereLanguage(null);
    setLogWhereLanguage(null);
  }, [setTraceWhere, setLogWhere, setTraceWhereLanguage, setLogWhereLanguage]);

  return {
    traceWhere,
    logWhere,
    traceWhereLanguage,
    logWhereLanguage,
    isFilterActive,
    isFilterExpanded,
    setIsFilterExpanded,
    onSubmit,
    clear,
  };
}
