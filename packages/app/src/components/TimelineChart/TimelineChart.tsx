import { memo, useEffect, useMemo, useRef, useState } from 'react';
import cx from 'classnames';
import { useVirtualizer } from '@tanstack/react-virtual';

import useResizable from '../../hooks/useResizable';
import { useDrag, usePrevious } from '../../utils';

import {
  TimelineChartRowEvents,
  type TTimelineEvent,
} from './TimelineChartRowEvents';
import { TimelineCursor } from './TimelineCursor';
import { TimelineMouseCursor } from './TimelineMouseCursor';
import { TimelineXAxis } from './TimelineXAxis';

import resizeStyles from '../../../styles/ResizablePanel.module.scss';
import styles from './TimelineChart.module.scss';

type Row = {
  id: string;
  label: React.ReactNode;
  events: TTimelineEvent[];
  style?: any;
  type?: string;
  className?: string;
  isActive?: boolean;
};

type Cursor = {
  id: string;
  start: number;
  color: string;
};

type TimelineChartProps = {
  rows: Row[];
  cursors?: Cursor[];
  scale?: number;
  rowHeight: number;
  onMouseMove?: (ts: number) => void;
  onClick?: (ts: number) => void;
  onEventClick?: (e: Row) => void;
  labelWidth: number;
  className?: string;
  style?: any;
  setScale?: (cb: (scale: number) => number) => void;
  scaleWithScroll?: boolean;
  initialScrollRowIndex?: number;
};

export const TimelineChart = memo(function ({
  rows,
  cursors,
  rowHeight,
  onMouseMove,
  onEventClick,
  labelWidth: initialLabelWidth,
  className,
  style,
  onClick,
  scale = 1,
  setScale,
  initialScrollRowIndex,
  scaleWithScroll = false,
}: TimelineChartProps) {
  const [offset, setOffset] = useState(0);
  const prevScale = usePrevious(scale);
  const initialWidthPercent = (initialLabelWidth / window.innerWidth) * 100;
  const { size: labelWidthPercent, startResize } = useResizable(
    initialWidthPercent,
    'left',
  );

  const labelWidth = (labelWidthPercent / 100) * window.innerWidth;

  const timelineRef = useRef<HTMLDivElement>(null);
  const onMouseEvent = (
    e: { clientX: number; clientY: number },
    cb: typeof onClick | typeof onMouseMove,
  ) => {
    if (timelineRef.current != null && cb != null) {
      const timelineContainer = timelineRef.current;
      const rect = timelineContainer.getBoundingClientRect();

      const x = e.clientX - rect.left;

      // Remove label width from calculations
      // Use clientWidth as that removes scroll bars
      const xPerc =
        (x - labelWidth) / (timelineContainer.clientWidth - labelWidth);
      cb(Math.max((offset / 100 + xPerc / scale) * maxVal));
    }
  };

  const useDragOptions: Parameters<typeof useDrag>[1] = useMemo(
    () => ({
      onDrag: e => {
        setOffset(v =>
          Math.min(
            Math.max(v - e.movementX * (0.125 / scale), 0),
            100 - 100 / scale,
          ),
        );
      },
    }),
    [scale, setOffset],
  );
  useDrag(timelineRef, useDragOptions);

  const [cursorXPerc, setCursorXPerc] = useState(0);

  const onWheel = (e: WheelEvent) => {
    if (scaleWithScroll) {
      e.preventDefault();
      setScale?.(v => Math.max(v - e.deltaY * 0.001, 1));
    }
  };

  useEffect(() => {
    if (prevScale != null && prevScale != scale) {
      setOffset(offset => {
        const newScale = scale;

        // we try to calculate the new offset we need to keep the cursor's
        // abs % the same between current scale and new scale
        // cursor abs % = cursorTime/maxVal = offset / 100 + xPerc / scale
        const boundedCursorXPerc = Math.max(Math.min(cursorXPerc, 1), 0);
        const newOffset =
          offset +
          (100 * boundedCursorXPerc) / prevScale -
          (100 * boundedCursorXPerc) / newScale;

        return Math.min(Math.max(newOffset, 0), 100 - 100 / scale);
      });
    }
  }, [scale, prevScale, cursorXPerc]);

  useEffect(() => {
    const element = timelineRef.current;
    if (element != null) {
      element.addEventListener('wheel', onWheel, {
        passive: false,
      });

      return () => {
        element.removeEventListener('wheel', onWheel);
      };
    }
  });

  const maxVal = useMemo(() => {
    let max = 0;
    for (const row of rows) {
      for (const event of row.events) {
        max = Math.max(max, event.end);
      }
    }
    return max * 1.1; // add 10% padding
  }, [rows]);

  const rowVirtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => timelineRef.current,
    estimateSize: () => rowHeight,
    overscan: 5,
  });
  const items = rowVirtualizer.getVirtualItems();

  const TIMELINE_AXIS_HEIGHT = 32;

  const [initialScrolled, setInitialScrolled] = useState(false);
  useEffect(() => {
    if (
      initialScrollRowIndex != null &&
      !initialScrolled &&
      initialScrollRowIndex >= 0
    ) {
      setInitialScrolled(true);
      rowVirtualizer.scrollToIndex(initialScrollRowIndex, {
        align: 'center',
      });
    }
  }, [initialScrollRowIndex, initialScrolled, rowVirtualizer]);

  return (
    <div
      style={{ position: 'relative', ...style }}
      className={className}
      ref={timelineRef}
      onClick={e => {
        onMouseEvent(e, onClick);
      }}
      onMouseMove={e => {
        onMouseEvent(e, onMouseMove);
      }}
    >
      {(cursors ?? ([] as const)).map(cursor => {
        const xPerc = (cursor.start / maxVal - offset / 100) * scale;
        return (
          <TimelineCursor
            key={cursor.id}
            xPerc={xPerc}
            height={timelineRef.current?.getBoundingClientRect().height ?? 300}
            labelWidth={labelWidth}
            color={cursor.color}
          />
        );
      })}
      <TimelineMouseCursor
        containerRef={timelineRef}
        maxVal={maxVal}
        height={timelineRef.current?.getBoundingClientRect().height ?? 300}
        labelWidth={labelWidth}
        scale={scale}
        offset={offset}
        xPerc={cursorXPerc}
        setXPerc={setCursorXPerc}
      />
      <TimelineXAxis
        maxVal={maxVal}
        height={timelineRef.current?.getBoundingClientRect().height ?? 300}
        labelWidth={labelWidth}
        scale={scale}
        offset={offset}
      />

      <div
        style={{
          height: `${rowVirtualizer.getTotalSize() + TIMELINE_AXIS_HEIGHT}px`,
          width: '100%',
          position: 'relative',
        }}
      >
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: '100%',
            transform: `translateY(${items?.[0]?.start ?? 0}px)`,
          }}
        >
          {rowVirtualizer.getVirtualItems().map(virtualRow => {
            const row = rows[virtualRow.index];

            return (
              <div
                onClick={() => onEventClick?.(row)}
                key={virtualRow.index}
                data-index={virtualRow.index}
                ref={rowVirtualizer.measureElement}
                className={`${cx(
                  'd-flex align-items-center overflow-hidden',
                  row.className,
                  styles.timelineRow,
                  row.isActive && styles.timelineRowActive,
                )}`}
                style={row.style}
              >
                <div
                  className={styles.labelContainer}
                  style={{
                    width: labelWidth,
                    minWidth: labelWidth,
                  }}
                >
                  {row.label}
                  <div
                    className={resizeStyles.resizeHandle}
                    onMouseDown={startResize}
                    style={{ backgroundColor: 'var(--color-bg-neutral)' }}
                  />
                </div>
                <TimelineChartRowEvents
                  events={row.events}
                  height={rowHeight}
                  maxVal={maxVal}
                  scale={scale}
                  offset={offset}
                />
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
});

TimelineChart.displayName = 'TimelineChart';
