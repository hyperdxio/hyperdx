import { memo, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import cx from 'classnames';
import { Flex, Kbd, Text } from '@mantine/core';
import { useVirtualizer } from '@tanstack/react-virtual';

import {
  TimelineMouseCursor,
  type TimelineMouseCursorHandle,
} from '@/components/TimelineChart/TimelineMouseCursor';
import {
  TimelineXAxis,
  type TimelineXAxisHandle,
} from '@/components/TimelineChart/TimelineXAxis';
import useResizable from '@/hooks/useResizable';
import { useStableCallback } from '@/hooks/useStableCallback';

import {
  TimelineChartRowEvents,
  type TTimelineEvent,
} from './TimelineChartRowEvents';
import { getMaxEventValue } from './utils';

import styles from './TimelineChart.module.scss';
import resizeStyles from '@styles/ResizablePanel.module.scss';

type Row = {
  events: TTimelineEvent[];
  id: string;
  isActive?: boolean;
  label: React.ReactNode;
  type?: string;
};

/**
 * Imperative bridge between the scroll-based zoom/pan model owned by
 * TimelineChart and the TimelineMinimap (which renders above the controls row,
 * outside this component). The minimap reads the current viewport via
 * getState(), reflects live scroll/zoom changes via subscribe(), and drives
 * zoom/pan through zoomToRange/panToOffset/reset.
 *
 * All fractions are in [0, 1] over the events timeline (the label column is
 * excluded from the events area, matching how spans are positioned).
 */
export type TimelineViewportState = {
  // Current zoom scale (>= 1; 1 = fully zoomed out).
  scale: number;
  // Fraction of the timeline scrolled past the left edge of the events area.
  offsetFrac: number;
  // Fraction of the timeline currently visible in the events area.
  viewportWidthFrac: number;
};

export type TimelineViewportController = {
  getState: () => TimelineViewportState;
  // Subscribe to scroll/zoom changes (rAF-throttled). Returns an unsubscribe.
  subscribe: (cb: () => void) => () => void;
  // Zoom so the events area shows exactly [startFrac, endFrac].
  zoomToRange: (startFrac: number, endFrac: number) => void;
  // Pan (at the current scale) so the events area's left edge is at offsetFrac.
  panToOffset: (offsetFrac: number) => void;
  // Return to the fully zoomed-out view.
  reset: () => void;
};

type TimelineChartProps = {
  initialScrollRowIndex: number;
  labelWidth: number;
  maxHeight: number;
  rowHeight: number;
  rows: Row[];
  onEventClick: (e: Row) => void;
  onReady?: (controller: TimelineViewportController) => void;
};

// Smallest selectable viewport width as a timeline fraction. Guards against
// divide-by-zero / runaway scale when brushing or resizing to a tiny range.
const MIN_VIEWPORT_FRAC = 0.02;

const axisHeight = 24;
const rowsMarginTop = 32;
const maxScale = 100;

export const TimelineChart = memo(function (props: TimelineChartProps) {
  const {
    initialScrollRowIndex,
    labelWidth: initialLabelWidth,
    maxHeight,
    rowHeight,
    rows,
    onEventClick,
    onReady,
  } = props;

  const initialWidthPercent = (initialLabelWidth / window.innerWidth) * 100;

  const { size: labelWidthPercent, startResize } = useResizable(
    initialWidthPercent,
    'left',
  );

  const labelWidth = useMemo(
    () => (labelWidthPercent / 100) * window.innerWidth,
    [labelWidthPercent],
  );

  // Mirrored into a ref synchronously during render so handlers wrapped in
  // useStableCallback (which sync via useLayoutEffect) cannot read a stale
  // value if a wheel/scroll event fires before the layout-effect tick. A
  // useLayoutEffect mirror would have the same gap we are trying to close.
  const labelWidthRef = useRef(labelWidth);

  labelWidthRef.current = labelWidth;

  const timelineRef = useRef<HTMLDivElement>(null);
  // Ref instead of state — height changes during a panel-resize drag would
  // otherwise re-render the virtualizer (and recreate every visible row's
  // inline onClick closure) for what's purely a cosmetic cursor-line height.
  // Children read it imperatively inside their `recompute` calls.
  const timelineHeightRef = useRef(0);

  const scaleRef = useRef(1);
  const timelineScrollerRef = useRef<HTMLDivElement>(null);
  const xAxisHandleRef = useRef<TimelineXAxisHandle>(null);
  const mouseCursorHandleRef = useRef<TimelineMouseCursorHandle>(null);

  useLayoutEffect(() => {
    const element = timelineRef.current;
    if (element == null) return;

    timelineHeightRef.current = element.getBoundingClientRect().height;
    xAxisHandleRef.current?.recompute();
    mouseCursorHandleRef.current?.recompute();

    const observer = new ResizeObserver(entries => {
      const entry = entries[0];
      if (entry == null) return;
      timelineHeightRef.current = entry.contentRect.height;
      xAxisHandleRef.current?.recompute();
      mouseCursorHandleRef.current?.recompute();
    });
    observer.observe(element);

    return () => observer.disconnect();
  }, []);

  const rowVirtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => timelineRef.current,
    estimateSize: () => rowHeight,
    overscan: 5,
  });

  const initialScrolledRef = useRef(false);

  useEffect(() => {
    initialScrolledRef.current = false;
  }, [initialScrollRowIndex]);

  useEffect(() => {
    if (!initialScrolledRef.current && initialScrollRowIndex >= 0) {
      initialScrolledRef.current = true;
      rowVirtualizer.scrollToIndex(initialScrollRowIndex, {
        align: 'center',
      });
    }
  }, [initialScrollRowIndex, rowVirtualizer]);

  const maxVal = useMemo(() => getMaxEventValue(rows), [rows]);

  // Subscribers (the minimap) notified on scroll/zoom so they can re-read the
  // viewport. rAF-throttled so native scroll bursts collapse to one read.
  const subscribersRef = useRef<Set<() => void>>(new Set());
  const notifyRafRef = useRef<number | null>(null);

  const notifyViewport = useStableCallback(() => {
    if (notifyRafRef.current != null) return;
    notifyRafRef.current = requestAnimationFrame(() => {
      notifyRafRef.current = null;
      subscribersRef.current.forEach(cb => cb());
    });
  });

  // Low-level commit shared by wheel-zoom and the minimap: set the scale, the
  // scroller width, and the scroll position, then re-layout the axis/cursor and
  // notify viewport subscribers. The browser clamps scrollLeft to a valid range.
  const commitViewport = useStableCallback(
    (newScale: number, newScrollLeft: number) => {
      const container = timelineRef.current;
      const scroller = timelineScrollerRef.current;
      if (!container || !scroller) return;

      const clamped = Math.min(Math.max(newScale, 1), maxScale);
      scaleRef.current = clamped;
      scroller.style.width = `${100 * clamped}%`;
      container.scrollLeft = newScrollLeft;

      xAxisHandleRef.current?.recompute();
      mouseCursorHandleRef.current?.recompute();
      notifyViewport();
    },
  );

  const getViewportState = useStableCallback((): TimelineViewportState => {
    const container = timelineRef.current;
    const scale = scaleRef.current;
    const clientW = container?.clientWidth ?? 1;
    const labelW = labelWidthRef.current;
    // Events area width at the current scale; matches the geometry used by
    // flushWheel (scroller width is 100*scale% of the container).
    const eventsW = Math.max(1, clientW * scale - labelW);
    const offsetFrac = container ? container.scrollLeft / eventsW : 0;
    const viewportWidthFrac = Math.min(1, (clientW - labelW) / eventsW);
    return { scale, offsetFrac, viewportWidthFrac };
  });

  const zoomToRange = useStableCallback(
    (startFrac: number, endFrac: number) => {
      const container = timelineRef.current;
      if (!container) return;
      const clientW = container.clientWidth;
      const labelW = labelWidthRef.current;
      const widthFrac = Math.max(endFrac - startFrac, MIN_VIEWPORT_FRAC);
      // Invert viewportWidthFrac = (W - labelW) / (W*scale - labelW).
      const newScale = (labelW + (clientW - labelW) / widthFrac) / clientW;
      const clamped = Math.min(Math.max(newScale, 1), maxScale);
      const eventsWNew = Math.max(1, clientW * clamped - labelW);
      commitViewport(clamped, startFrac * eventsWNew);
    },
  );

  const panToOffset = useStableCallback((offsetFrac: number) => {
    const container = timelineRef.current;
    if (!container) return;
    const clientW = container.clientWidth;
    const labelW = labelWidthRef.current;
    const eventsW = Math.max(1, clientW * scaleRef.current - labelW);
    commitViewport(scaleRef.current, offsetFrac * eventsW);
  });

  const resetViewport = useStableCallback(() => {
    commitViewport(1, 0);
  });

  const subscribeViewport = useStableCallback((cb: () => void) => {
    subscribersRef.current.add(cb);
    return () => {
      subscribersRef.current.delete(cb);
    };
  });

  // Stable controller object created once; methods are stable (useStableCallback).
  const controllerRef = useRef<TimelineViewportController | null>(null);
  if (controllerRef.current == null) {
    controllerRef.current = {
      getState: getViewportState,
      subscribe: subscribeViewport,
      zoomToRange,
      panToOffset,
      reset: resetViewport,
    };
  }

  useEffect(() => {
    if (controllerRef.current != null) {
      onReady?.(controllerRef.current);
    }
  }, [onReady]);

  // Native horizontal scroll (trackpad / scrollbar) pans the events area; keep
  // the minimap viewport rectangle in sync.
  useEffect(() => {
    const element = timelineRef.current;
    if (element == null) return;
    const onScroll = () => notifyViewport();
    element.addEventListener('scroll', onScroll, { passive: true });
    return () => element.removeEventListener('scroll', onScroll);
  }, [notifyViewport]);

  // Re-notify subscribers when the label column is resized, because the
  // events-area width fraction changes even though scale and scrollLeft don't.
  // Without this the minimap viewport rect keeps stale offset/width fractions
  // until the next scroll or wheel-zoom.
  useEffect(() => {
    notifyViewport();
  }, [labelWidth, notifyViewport]);

  useEffect(() => {
    return () => {
      if (notifyRafRef.current != null) {
        cancelAnimationFrame(notifyRafRef.current);
        notifyRafRef.current = null;
      }
    };
  }, []);

  // Wheel deltas accumulate into a pending state and the zoom commit runs
  // once per frame via rAF, so a fast scroll in one frame collapses to a
  // single read+write pass rather than thrashing layout per delta.
  const wheelStateRef = useRef<{
    pendingDelta: number;
    pendingClientX: number;
    rafId: number | null;
  }>({ pendingDelta: 0, pendingClientX: 0, rafId: null });

  const flushWheel = useStableCallback(() => {
    const state = wheelStateRef.current;
    state.rafId = null;

    const delta = state.pendingDelta;
    const cursorClientX = state.pendingClientX;
    state.pendingDelta = 0;

    if (delta === 0) {
      return;
    }

    const container = timelineRef.current;
    const scroller = timelineScrollerRef.current;

    if (!container || !scroller) {
      return;
    }

    const oldScale = scaleRef.current;
    const newScale = Math.min(Math.max(oldScale + -delta * 0.01, 1), maxScale);

    if (newScale === oldScale) {
      return;
    }

    const rect = container.getBoundingClientRect();

    const clientW = container.clientWidth;
    const labelW = labelWidthRef.current;

    const eventsWOld = Math.max(1, clientW * oldScale - labelW);
    const eventsWNew = Math.max(1, clientW * newScale - labelW);

    // Clamp cursor to the events area so hovering the label column anchors
    // the zoom at the events-area left edge instead of going negative.
    const cursorPx = Math.min(
      Math.max(0, cursorClientX - rect.left - labelW),
      eventsWOld,
    );

    const fraction = (container.scrollLeft + cursorPx) / eventsWOld;

    // Keep the cursor anchored to the same timeline fraction across the zoom.
    commitViewport(newScale, fraction * eventsWNew - cursorPx);
  });

  const onWheel = useStableCallback((e: WheelEvent) => {
    const { deltaY, metaKey, ctrlKey, clientX } = e;

    if (!(metaKey || ctrlKey)) {
      return;
    }

    e.preventDefault();

    const state = wheelStateRef.current;
    state.pendingDelta += deltaY;
    state.pendingClientX = clientX;

    if (state.rafId != null) {
      return;
    }
    state.rafId = requestAnimationFrame(flushWheel);
  });

  useEffect(() => {
    const element = timelineRef.current;

    if (element != null) {
      // `passive: false` because we call e.preventDefault() to suppress
      // page scroll when zooming with cmd/ctrl + wheel.
      element.addEventListener('wheel', onWheel, { passive: false });

      return () => {
        element.removeEventListener('wheel', onWheel);
      };
    }
  }, [onWheel]);

  useEffect(() => {
    const state = wheelStateRef.current;
    return () => {
      if (state.rafId != null) {
        cancelAnimationFrame(state.rafId);
        state.rafId = null;
      }
    };
  }, []);

  const handleRowClick = useStableCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const id = e.currentTarget.dataset.id;
      if (id == null) return;
      const row = rows.find(r => r.id === id);
      if (row == null) return;
      onEventClick(row);
    },
  );

  return (
    <Flex mah={maxHeight} direction="column">
      <Flex justify="end" mb="sm">
        <Text>
          <Kbd>⌘/Ctrl</Kbd> + <Kbd>scroll</Kbd> to zoom
        </Text>
      </Flex>

      <div className={styles.timelineViewport}>
        <div className={styles.timelineContainer} ref={timelineRef}>
          <div
            ref={timelineScrollerRef}
            className={styles.timelineScroller}
            style={{
              height: `${rowVirtualizer.getTotalSize() + axisHeight + rowsMarginTop}px`,
            }}
          >
            <TimelineXAxis
              ref={xAxisHandleRef}
              maxVal={maxVal}
              heightRef={timelineHeightRef}
              labelWidth={labelWidth}
            />

            <div
              aria-hidden
              className={styles.timelineCorner}
              style={{
                width: labelWidth,
                height: `${axisHeight}px`,
                marginTop: `-${axisHeight}px`,
              }}
            />

            {rowVirtualizer.getVirtualItems().map(virtualRow => {
              const row = rows[virtualRow.index];
              const top = virtualRow.start + axisHeight + rowsMarginTop;

              return (
                <div
                  key={virtualRow.index}
                  data-index={virtualRow.index}
                  data-id={row.id}
                  ref={rowVirtualizer.measureElement}
                  className={cx(styles.timelineRow, {
                    [styles.timelineRowActive]: row.isActive,
                  })}
                  style={{ top }}
                  onClick={handleRowClick}
                >
                  <div
                    className={styles.labelContainer}
                    style={{ width: labelWidth }}
                  >
                    <div className={styles.labelContent}>{row.label}</div>
                  </div>

                  <div
                    className={styles.eventsContainer}
                    style={{ height: `${virtualRow.size}px` }}
                  >
                    <TimelineChartRowEvents
                      events={row.events}
                      height={rowHeight}
                      maxVal={maxVal}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div
          className={styles.resizeHandleContainer}
          style={{ transform: `translateX(${labelWidth}px)` }}
        >
          <div
            className={resizeStyles.resizeHandle}
            onMouseDown={startResize}
            style={{ backgroundColor: 'var(--color-bg-neutral)' }}
          />
        </div>

        <TimelineMouseCursor
          ref={mouseCursorHandleRef}
          containerRef={timelineRef}
          maxVal={maxVal}
          heightRef={timelineHeightRef}
          labelWidth={labelWidth}
          scaleRef={scaleRef}
        />
      </div>
    </Flex>
  );
});

TimelineChart.displayName = 'TimelineChart';
