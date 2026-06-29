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

import styles from './TimelineChart.module.scss';
import resizeStyles from '@styles/ResizablePanel.module.scss';

type Row = {
  events: TTimelineEvent[];
  id: string;
  isActive?: boolean;
  label: React.ReactNode;
  type?: string;
};

type TimelineChartProps = {
  initialScrollRowIndex: number;
  labelWidth: number;
  maxHeight: number;
  rowHeight: number;
  rows: Row[];
  onEventClick: (e: Row) => void;
};

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

  const maxVal = useMemo(() => {
    let max = 0;

    for (const row of rows) {
      for (const event of row.events) {
        max = Math.max(max, event.end);
      }
    }

    return max * 1.1;
  }, [rows]);

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

    scaleRef.current = newScale;
    scroller.style.width = `${100 * newScale}%`;
    container.scrollLeft = fraction * eventsWNew - cursorPx;

    xAxisHandleRef.current?.recompute();
    mouseCursorHandleRef.current?.recompute();
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
