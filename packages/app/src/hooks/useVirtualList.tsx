'use client';

import { useCallback, useMemo, useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';

export interface UseVirtualListOptions {
  /**
   * Scroll element to virtualize against, when the list itself is not the
   * scroller (e.g. a page that scrolls in the app shell container). Defaults
   * to the element `containerRef` is attached to.
   */
  getScrollElement?: () => Element | null;
  /**
   * Vertical offset in pixels between the top of the scroll element's content
   * and the top of the list. Required when `getScrollElement` points at an
   * outer scroller with content above the list.
   */
  scrollMargin?: number;
  /** Item keys, so cached measurements survive reordering and filtering. */
  getItemKey?: (index: number) => string | number;
}

/**
 * A custom hook for virtualizing large lists to improve rendering performance.
 * Uses @tanstack/react-virtual under the hood to only render visible items.
 *
 * @param count - Total number of items in the list
 * @param estimate - Assumed row height in pixels until the row is measured,
 *   either one value for every row or a per-index function for lists whose
 *   rows differ in height. Pass a stable (memoized) function. A more accurate
 *   estimate will reduce the perceived wobbliness of the list as it scrolls.
 * @param overscan - Number of items to render outside the visible area (default: 10)
 * @param options - Optional overrides for virtualizing against an outer scroll
 *   element (see {@link UseVirtualListOptions})
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
  estimate: number | ((index: number) => number),
  overscan: number = 10,
  options: UseVirtualListOptions = {},
) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const { getScrollElement, scrollMargin = 0, getItemKey } = options;
  const rowVirtualizer = useVirtualizer({
    count,
    getScrollElement: () => getScrollElement?.() ?? containerRef.current,
    estimateSize: useCallback(
      (index: number) =>
        typeof estimate === 'function' ? estimate(index) : estimate,
      [estimate],
    ),
    overscan,
    scrollMargin,
    getItemKey,
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
            // Item offsets include scrollMargin but getTotalSize() excludes it,
            // so the last item's end has to be brought into the same frame as
            // the total or the bottom spacer comes up short.
            Math.max(
              0,
              totalSize -
                (virtualItems[virtualItems.length - 1].end -
                  rowVirtualizer.options.scrollMargin),
            ),
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
