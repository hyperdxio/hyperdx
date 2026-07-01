import { useCallback, useState } from 'react';
import { useQueryState } from 'nuqs';

export default function useWaterfallSearchState({
  hasLogSource,
}: {
  hasLogSource?: boolean;
}) {
  const [traceWhere, setTraceWhere] = useQueryState('traceWhere');
  const [logWhere, setLogWhere] = useQueryState('logWhere');
  // Persisted alongside the WHERE values so a shared link / reload rebuilds the
  // query with the same language the filter was written in (lucene vs sql).
  const [whereLanguage, setWhereLanguage] = useQueryState('whereLanguage');

  const isFilterActive = !!traceWhere || !!(hasLogSource && logWhere);

  const [isFilterExpanded, setIsFilterExpanded] = useState(isFilterActive);

  const onSubmit = useCallback(
    (data: {
      traceWhere: string;
      logWhere: string;
      whereLanguage?: string;
    }) => {
      setTraceWhere(data.traceWhere || null);
      setLogWhere(data.logWhere || null);
      if (data.whereLanguage !== undefined) {
        setWhereLanguage(data.whereLanguage || null);
      }
    },
    [setTraceWhere, setLogWhere, setWhereLanguage],
  );

  const clear = useCallback(() => {
    setTraceWhere(null);
    setLogWhere(null);
    setWhereLanguage(null);
  }, [setTraceWhere, setLogWhere, setWhereLanguage]);

  return {
    traceWhere,
    logWhere,
    whereLanguage,
    isFilterActive,
    isFilterExpanded,
    setIsFilterExpanded,
    onSubmit,
    clear,
  };
}
