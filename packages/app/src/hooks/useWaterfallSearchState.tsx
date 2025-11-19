import { useCallback, useState } from 'react';
import { useQueryState } from 'nuqs';

export default function useWaterfallSearchState({
  hasLogSource,
}: {
  hasLogSource?: boolean;
}) {
  const [traceWhere, setTraceWhere] = useQueryState('traceWhere');
  const [logWhere, setLogWhere] = useQueryState('logWhere');

  const isFilterActive = !!traceWhere || !!(hasLogSource && logWhere);

  const [isFilterExpanded, setIsFilterExpanded] = useState(isFilterActive);

  const onSubmit = useCallback(
    (data: { traceWhere: string; logWhere: string }) => {
      setTraceWhere(data.traceWhere || null);
      setLogWhere(data.logWhere || null);
    },
    [setTraceWhere, setLogWhere],
  );

  const clear = useCallback(() => {
    setTraceWhere(null);
    setLogWhere(null);
  }, [setTraceWhere, setLogWhere]);

  return {
    traceWhere,
    logWhere,
    isFilterActive,
    isFilterExpanded,
    setIsFilterExpanded,
    onSubmit,
    clear,
  };
}
