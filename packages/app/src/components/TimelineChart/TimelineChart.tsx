import {
  memo,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
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

import resizeStyles from '../../../styles/ResizablePanel.module.scss';
import styles from './TimelineChart.module.scss';

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

  const labelWidth = (labelWidthPercent / 100) * window.innerWidth;

  const timelineRef = useRef<HTMLDivElement>(null);
  const [timelineHeight, setTimelineHeight] = useState(0);

  useLayoutEffect(() => {
    const element = timelineRef.current;
    if (element == null) return;

    setTimelineHeight(element.getBoundingClientRect().height);

    const observer = new ResizeObserver(entries => {
      const entry = entries[0];
      if (entry == null) return;
      setTimelineHeight(entry.contentRect.height);
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

  const initialScrolled = useRef(false);

  useEffect(() => {
    if (!initialScrolled.current && initialScrollRowIndex >= 0) {
      initialScrolled.current = true;
      rowVirtualizer.scrollToIndex(initialScrollRowIndex, {
        align: 'center',
      });
    }
  }, [initialScrollRowIndex, rowVirtualizer]);

  const scale = useRef(1);
  const timelineScrollerRef = useRef<HTMLDivElement>(null);
  const xAxisHandleRef = useRef<TimelineXAxisHandle>(null);
  const mouseCursorHandleRef = useRef<TimelineMouseCursorHandle>(null);

  const maxVal = useMemo(() => {
    let max = 0;

    for (const row of rows) {
      for (const event of row.events) {
        max = Math.max(max, event.end);
      }
    }

    return max * 1.1;
  }, [rows]);

  const onWheel = useStableCallback((e: WheelEvent) => {
    const { deltaY, metaKey, ctrlKey, clientX } = e;

    if (!(metaKey || ctrlKey)) {
      return;
    }

    e.preventDefault();

    const container = timelineRef.current;
    const scroller = timelineScrollerRef.current;

    if (!container || !scroller) {
      return;
    }

    const oldScale = scale.current;
    const newScale = Math.max(oldScale + -deltaY * 0.01, 1);

    if (newScale === oldScale) {
      return;
    }

    const rect = container.getBoundingClientRect();

    const clientW = container.clientWidth;

    const eventsWOld = Math.max(1, clientW * oldScale - labelWidth);
    const eventsWNew = Math.max(1, clientW * newScale - labelWidth);

    // Clamp cursor to the events area so hovering the label column anchors
    // the zoom at the events-area left edge instead of going negative.
    const cursorPx = Math.min(
      Math.max(0, clientX - rect.left - labelWidth),
      eventsWOld,
    );

    const fraction = (container.scrollLeft + cursorPx) / eventsWOld;

    scale.current = newScale;
    scroller.style.width = `${100 * newScale}%`;
    container.scrollLeft = fraction * eventsWNew - cursorPx;

    xAxisHandleRef.current?.recompute();
    mouseCursorHandleRef.current?.recompute();
  });

  useEffect(() => {
    const element = timelineRef.current;

    if (element != null) {
      element.addEventListener('wheel', onWheel, { passive: false });

      return () => {
        element.removeEventListener('wheel', onWheel);
      };
    }
  }, [onWheel]);

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
              height={timelineHeight}
              labelWidth={labelWidth}
              scaleRef={scale}
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
                  onClick={() => onEventClick(row)}
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
          height={timelineHeight}
          labelWidth={labelWidth}
          scaleRef={scale}
        />
      </div>
    </Flex>
  );
});

TimelineChart.displayName = 'TimelineChart';
