import { useCallback, useLayoutEffect, useRef } from 'react';
import { useQueryState } from 'nuqs';

import { eventRowWhereParser } from '@/components/eventRowWhere';

// The waterfall treats the first hint after mount as a restored selection and
// keeps it. Drop the previous span when the opened row changes so the next
// view follows the new row. The first mount keeps a selection that arrived
// with the URL.
//
// useLayoutEffect, not useEffect. Child effects run first, so a parent
// useEffect clears the span only after the waterfall has applied the new
// hint and marked it done. The next render then skips that hint.
export function useOpenedRowSpanSelection(rowId: string | undefined) {
  const [, setEventRowWhere] = useQueryState(
    'eventRowWhere',
    eventRowWhereParser,
  );
  const openedRowIdRef = useRef(rowId);

  useLayoutEffect(() => {
    if (openedRowIdRef.current === rowId) {
      return;
    }
    openedRowIdRef.current = rowId;
    setEventRowWhere(null);
  }, [rowId, setEventRowWhere]);

  return useCallback(() => {
    setEventRowWhere(null);
  }, [setEventRowWhere]);
}
