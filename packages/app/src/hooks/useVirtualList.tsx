'use client';

import { useCallback, useMemo, useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';

export const useVirtualList = (
  count: number,
  estimate: number,
  overscan: number = 10,
) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const rowVirtualizer = useVirtualizer({
    count,
    getScrollElement: () => containerRef.current,
    estimateSize: useCallback(() => estimate, [estimate]),
    overscan,
  });

  const virtualItems = rowVirtualizer.getVirtualItems();
  const totalSize = rowVirtualizer.getTotalSize();

  const [paddingTop, paddingBottom] = useMemo(
    () =>
      virtualItems.length > 0
        ? [
            Math.max(
              0,
              virtualItems[0].start - rowVirtualizer.options.scrollMargin,
            ),
            Math.max(0, totalSize - virtualItems[virtualItems.length - 1].end),
          ]
        : [0, 0],
    [virtualItems, rowVirtualizer.options.scrollMargin, totalSize],
  );

  return {
    containerRef,
    rowVirtualizer,
    virtualItems,
    paddingTop,
    paddingBottom,
  };
};
