'use client';

import { useCallback, useMemo, useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';

/**
 * A custom hook for virtualizing large lists to improve rendering performance.
 * Uses @tanstack/react-virtual under the hood to only render visible items.
 *
 * @param count - Total number of items in the list
 * @param estimate - Estimated height of each row in pixels
 * @param overscan - Number of items to render outside the visible area (default: 10)
 *
 * @returns An object containing:
 *   - containerRef: Ref to attach to the scrollable container element
 *   - rowVirtualizer: The virtualizer instance for advanced usage
 *   - virtualItems: Array of currently visible items with their indices and sizes
 *   - paddingTop: Top padding value to maintain scroll position
 *   - paddingBottom: Bottom padding value to maintain scroll position
 *
 * @example
 * ```tsx
 * const MyList = ({ items }) => {
 *   const { containerRef, virtualItems, paddingTop, paddingBottom } = useVirtualList(
 *     items.length,
 *     40, // 40px estimated row height
 *     10  // render 10 items outside viewport
 *   );
 *
 *   return (
 *     <div ref={containerRef} style={{ height: '400px', overflow: 'auto' }}>
 *       {paddingTop > 0 && <div style={{ height: paddingTop }} />}
 *       {virtualItems.map(virtualRow => (
 *         <div key={virtualRow.index}>
 *           {items[virtualRow.index].name}
 *         </div>
 *       ))}
 *       {paddingBottom > 0 && <div style={{ height: paddingBottom }} />}
 *     </div>
 *   );
 * };
 * ```
 */
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
