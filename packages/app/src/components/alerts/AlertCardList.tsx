import { useCallback, useLayoutEffect, useRef, useState } from 'react';

import { AlertDetails } from '@/components/alerts/AlertDetails';
import { InfiniteScrollFooter } from '@/components/InfiniteScrollFooter';
import { useVirtualList } from '@/hooks/useVirtualList';
import { APP_CONTENT_SCROLL_CONTAINER_ID } from '@/layout';
import type { AlertsPageItem } from '@/types';

/**
 * Heights assumed until a row is measured. Every correction shifts the rows
 * below it, so a per-row estimate rather than one average keeps the list from
 * visibly wobbling as it is scrolled. Measured in the browser: a row is 66px,
 * tag badges add 18px and the note toggle 27px.
 */
const ROW_HEIGHT = 66;
const TAGS_HEIGHT = 18;
const NOTE_TOGGLE_HEIGHT = 27;

function estimateItemHeight(alert: AlertsPageItem): number {
  return (
    ROW_HEIGHT +
    (alert.tags?.length > 0 ? TAGS_HEIGHT : 0) +
    (alert.note ? NOTE_TOGGLE_HEIGHT : 0)
  );
}

/**
 * Measures how far the list sits below the top of the scroll container's
 * content, which the virtualizer needs to map scroll offsets onto item
 * offsets. Adding `scrollTop` makes the result independent of where the page
 * happens to be scrolled to.
 */
function useScrollMargin(listRef: React.RefObject<HTMLDivElement | null>) {
  const [scrollMargin, setScrollMargin] = useState(0);

  useLayoutEffect(() => {
    const scroller = document.getElementById(APP_CONTENT_SCROLL_CONTAINER_ID);
    const list = listRef.current;
    if (!scroller || !list) return;

    const measure = () => {
      const offset =
        list.getBoundingClientRect().top -
        scroller.getBoundingClientRect().top +
        scroller.scrollTop;
      setScrollMargin(prev => (prev === offset ? prev : offset));
    };

    measure();

    // The scroller catches viewport resizes; the list's parent catches the
    // filter row and info banner changing height above it.
    const observer = new ResizeObserver(measure);
    observer.observe(scroller);
    if (list.parentElement) observer.observe(list.parentElement);
    return () => observer.disconnect();
  }, [listRef]);

  return scrollMargin;
}

type AlertCardListProps = {
  /** Sorted (name-ascending) list of alerts */
  alerts: AlertsPageItem[];
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  isFetchNextPageError: boolean;
  onLoadMore: () => void;
};

export function AlertCardList({
  alerts: items,
  hasNextPage,
  isFetchingNextPage,
  isFetchNextPageError,
  onLoadMore,
}: AlertCardListProps) {
  const listRef = useRef<HTMLDivElement>(null);
  const scrollMargin = useScrollMargin(listRef);

  const estimateSize = useCallback(
    (index: number) => estimateItemHeight(items[index]),
    [items],
  );

  const { rowVirtualizer, virtualItems, paddingTop, paddingBottom } =
    useVirtualList(items.length, estimateSize, 10, {
      getScrollElement: () =>
        document.getElementById(APP_CONTENT_SCROLL_CONTAINER_ID),
      scrollMargin,
      getItemKey: useCallback((index: number) => items[index]._id, [items]),
    });

  return (
    <>
      <div ref={listRef}>
        {paddingTop > 0 && <div style={{ height: paddingTop }} />}
        {virtualItems.map(virtualRow => (
          <div
            key={virtualRow.key}
            data-index={virtualRow.index}
            ref={rowVirtualizer.measureElement}
          >
            <AlertDetails alert={items[virtualRow.index]} />
          </div>
        ))}
        {paddingBottom > 0 && <div style={{ height: paddingBottom }} />}
      </div>
      <InfiniteScrollFooter
        hasNextPage={hasNextPage}
        isFetchingNextPage={isFetchingNextPage}
        isFetchNextPageError={isFetchNextPageError}
        onLoadMore={onLoadMore}
        loadingLabel="Loading more alerts…"
        errorLabel="Failed to load more alerts."
        sentinelTestId="alerts-load-more"
        errorTestId="alerts-load-error"
      />
    </>
  );
}
