import { memo, RefObject, useEffect, useRef, useState } from 'react';
import cx from 'classnames';
import { Tooltip } from '@mantine/core';
import { useVirtualizer } from '@tanstack/react-virtual';

import { useDrag, usePrevious } from './utils';

import styles from '../styles/TimelineChart.module.scss';

type TimelineEventT = {
  id: string;
  start: number;
  end: number;
  tooltip: string;
  color: string;
  body: React.ReactNode;
  minWidthPerc?: number;
};

const NewTimelineRow = memo(
  function NewTimelineRow({
    events,
    maxVal,
    height,
    eventStyles,
    onEventHover,
    scale,
    offset,
  }: {
    events: TimelineEventT[] | undefined;
    maxVal: number;
    height: number;
    scale: number;
    offset: number;
    eventStyles?: any;
    onEventHover?: Function;
    onEventClick?: (event: any) => any;
  }) {
    const onHover = onEventHover ?? (() => {});
    return (
      <div
        className="d-flex overflow-hidden"
        style={{ width: 0, flexGrow: 1, height }}
      >
        <div
          style={{ marginRight: `${(-1 * offset * scale).toFixed(6)}%` }}
        ></div>
        {(events ?? []).map((e: TimelineEventT, i, arr) => {
          const minWidth = (e.minWidthPerc ?? 0) / 100;
          const lastEvent = arr[i - 1];
          const lastEventMinEnd =
            lastEvent?.start != null ? lastEvent?.start + maxVal * minWidth : 0;
          const lastEventEnd = Math.max(lastEvent?.end ?? 0, lastEventMinEnd);

          const percWidth =
            scale * Math.max((e.end - e.start) / maxVal, minWidth) * 100;
          const percMarginLeft =
            scale * (((e.start - lastEventEnd) / maxVal) * 100);

          return (
            <Tooltip
              key={e.id}
              label={e.tooltip}
              color="gray"
              withArrow
              multiline
              transitionProps={{ transition: 'fade-right' }}
              style={{
                fontSize: 11,
                maxWidth: 300,
                wordBreak: 'break-word',
              }}
            >
              <div
                onMouseEnter={() => onHover(e.id)}
                className="d-flex align-items-center h-100 cursor-pointer text-truncate hover-opacity"
                style={{
                  userSelect: 'none',
                  backgroundColor: e.color,
                  minWidth: `${percWidth.toFixed(6)}%`,
                  width: `${percWidth.toFixed(6)}%`,
                  marginLeft: `${percMarginLeft.toFixed(6)}%`,
                  ...eventStyles,
                }}
              >
                <div style={{ margin: 'auto' }} className="px-2">
                  {e.body}
                </div>
              </div>
            </Tooltip>
          );
        })}
      </div>
    );
  },
  // TODO: Revisit this?
  // (prev, next) => {
  //   // TODO: This is a hack for cheap comparisons
  //   return (
  //     prev.maxVal === next.maxVal &&
  //     prev.events?.length === next.events?.length &&
  //     prev.scale === next.scale &&
  //     prev.offset === next.offset
  //   );
  // },
);

function renderMs(ms: number) {
  return ms < 1000
    ? `${Math.round(ms)}ms`
    : ms % 1000 === 0
    ? `${Math.floor(ms / 1000)}s`
    : `${(ms / 1000).toFixed(3)}s`;
}

function TimelineXAxis({
  maxVal,
  labelWidth,
  height,
  scale,
  offset,
}: {
  maxVal: number;
  labelWidth: number;
  height: number;
  scale: number;
  offset: number;
}) {
  const scaledMaxVal = maxVal / scale;
  // TODO: Turn this into a function
  const interval =
    scaledMaxVal < 10
      ? 1
      : scaledMaxVal < 100
      ? 10
      : scaledMaxVal < 300
      ? 20
      : scaledMaxVal < 1000
      ? 100
      : scaledMaxVal < 3000
      ? 200
      : scaledMaxVal < 10000
      ? 1000
      : scaledMaxVal < 30000
      ? 2000
      : scaledMaxVal < 100000
      ? 10000
      : scaledMaxVal < 300000
      ? 20000
      : scaledMaxVal < 10 * 60 * 1000
      ? 1 * 60 * 1000
      : scaledMaxVal < 30 * 60 * 1000
      ? 3 * 60 * 1000
      : scaledMaxVal < 60 * 60 * 1000
      ? 6 * 60 * 1000
      : 20 * 60 * 1000;

  const numTicks = Math.floor(maxVal / interval);
  const percSpacing = (interval / maxVal) * 100 * scale;

  const ticks = [];
  for (let i = 0; i < numTicks; i++) {
    ticks.push(
      <div
        key={i}
        style={{
          height,
          width: 1,
          marginRight: -1,
          marginLeft: i === 0 ? 0 : `${percSpacing.toFixed(6)}%`,
          background: 'rgba(255, 255, 255, 0.08)',
        }}
      >
        <div className="ms-2 text-slate-400 fs-8.5">
          {renderMs(i * interval)}
        </div>
      </div>,
    );
  }

  return (
    <div
      style={{
        position: 'sticky',
        top: 0,
        height: 4,
        paddingTop: 4,
        zIndex: 200,
        pointerEvents: 'none',
      }}
    >
      <div className={`${cx('d-flex align-items-center')}`}>
        <div style={{ width: labelWidth, minWidth: labelWidth }}></div>
        <div className="d-flex w-100 overflow-hidden">
          <div
            style={{ marginRight: `${(-1 * offset * scale).toFixed(6)}%` }}
          ></div>
          {ticks}
        </div>
      </div>
    </div>
  );
}

function TimelineCursor({
  xPerc,
  overlay,
  labelWidth,
  color,
  height,
}: {
  xPerc: number;
  overlay?: React.ReactNode;
  labelWidth: number;
  color: string;
  height: number;
}) {
  // Bound [-1,100] to 6 digits as a percent, -1 so it can slide off the right side of the screen
  const cursorMarginLeft = `${Math.min(Math.max(xPerc * 100, -1), 100).toFixed(
    6,
  )}%`;

  return (
    <div
      style={{
        position: 'sticky',
        top: 0,
        height: 0,
        zIndex: 250,
        pointerEvents: 'none',
        display: xPerc <= 0 ? 'none' : 'block',
      }}
    >
      <div className="d-flex">
        <div style={{ width: labelWidth, minWidth: labelWidth }} />
        <div className="w-100 overflow-hidden">
          <div style={{ marginLeft: cursorMarginLeft }}>
            {overlay != null && (
              <div
                style={{
                  height: 0,
                  marginLeft: xPerc < 0.5 ? 12 : -150,
                  top: 12,
                  position: 'relative',
                }}
              >
                <div>
                  <span
                    className="p-2 rounded"
                    style={{ background: 'rgba(0,0,0,0.75)' }}
                  >
                    {overlay}
                  </span>
                </div>
              </div>
            )}
            <div
              style={{
                height,
                width: 1,
                background: color,
              }}
            ></div>
          </div>
        </div>
      </div>
    </div>
  );
}

function TimelineMouseCursor({
  containerRef,
  maxVal,
  labelWidth,
  height,
  scale,
  offset,
  xPerc,
  setXPerc,
}: {
  containerRef: RefObject<HTMLDivElement>;
  maxVal: number;
  labelWidth: number;
  height: number;
  scale: number;
  offset: number;
  xPerc: number;
  setXPerc: (p: number) => any;
}) {
  const [showCursor, setShowCursor] = useState(false);
  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (containerRef.current != null) {
        const timelineContainer = containerRef.current;
        const rect = timelineContainer.getBoundingClientRect();

        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;

        // Remove label width from calculations
        // Use clientWidth as that removes scroll bars
        const xPerc =
          (x - labelWidth) / (timelineContainer.clientWidth - labelWidth);
        if (onMouseMove != null) {
          setXPerc(xPerc);
        }
      }
    };
    const onMouseEnter = () => setShowCursor(true);
    const onMouseLeave = () => setShowCursor(false);

    const element = containerRef.current;
    element?.addEventListener('mousemove', onMouseMove);
    element?.addEventListener('mouseleave', onMouseLeave);
    element?.addEventListener('mouseenter', onMouseEnter);

    return () => {
      element?.removeEventListener('mousemove', onMouseMove);
      element?.removeEventListener('mouseleave', onMouseLeave);
      element?.removeEventListener('mouseenter', onMouseEnter);
    };
  }, [containerRef, labelWidth, setXPerc]);

  const cursorTime = (offset / 100 + Math.max(xPerc, 0) / scale) * maxVal;

  return showCursor ? (
    <TimelineCursor
      xPerc={Math.max(xPerc, 0)}
      overlay={renderMs(Math.max(cursorTime, 0))}
      height={height}
      labelWidth={labelWidth}
      color="#ffffff88"
    />
  ) : null;
}

type Row = {
  id: string;
  label: React.ReactNode;
  events: TimelineEventT[];
  style?: any;
  className?: string;
};

export default function TimelineChart({
  rows,
  cursors,
  rowHeight,
  maxVal,
  onMouseMove,
  onEventClick,
  labelWidth,
  className,
  style,
  onClick,
  scale = 1,
  setScale = () => {},
  initialScrollRowIndex,
  scaleWithScroll: scaleWithScroll = false,
}: {
  rows: Row[] | undefined;
  cursors?: {
    id: string;
    start: number;
    color: string;
  }[];
  scale?: number;
  rowHeight: number;
  maxVal: number;
  onMouseMove?: (ts: number) => any;
  onClick?: (ts: number) => any;
  onEventClick?: (e: any) => any;
  labelWidth: number;
  className?: string;
  style?: any;
  setScale?: (cb: (scale: number) => number) => any;
  scaleWithScroll?: boolean;
  initialScrollRowIndex?: number;
}) {
  const [offset, setOffset] = useState(0);
  const prevScale = usePrevious(scale);

  const timelineRef = useRef<HTMLDivElement>(null);
  const onMouseEvent = (
    e: { clientX: number; clientY: number },
    cb: Function | undefined,
  ) => {
    if (timelineRef.current != null && cb != null) {
      const timelineContainer = timelineRef.current;
      const rect = timelineContainer.getBoundingClientRect();

      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;

      // Remove label width from calculations
      // Use clientWidth as that removes scroll bars
      const xPerc =
        (x - labelWidth) / (timelineContainer.clientWidth - labelWidth);
      cb(Math.max((offset / 100 + xPerc / scale) * maxVal));
    }
  };

  useDrag(timelineRef, [], {
    onDrag: e => {
      setOffset(v =>
        Math.min(
          Math.max(v - e.movementX * (0.125 / scale), 0),
          100 - 100 / scale,
        ),
      );
    },
  });

  const [cursorXPerc, setCursorXPerc] = useState(0);

  const onWheel = (e: WheelEvent) => {
    if (scaleWithScroll) {
      e.preventDefault();
      setScale(v => Math.max(v - e.deltaY * 0.001, 1));
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

  const rowVirtualizer = useVirtualizer({
    count: rows?.length ?? 0,
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
            const row = rows?.[virtualRow.index] as Row;
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
                )}`}
                style={{
                  // position: 'absolute',
                  // top: 0,
                  // left: 0,
                  // width: '100%',
                  // height: `${virtualRow.size}px`,
                  // transform: `translateY(${virtualRow.start}px)`,
                  ...row.style,
                }}
              >
                <div style={{ width: labelWidth, minWidth: labelWidth }}>
                  {row.label}
                </div>
                <NewTimelineRow
                  events={row.events}
                  height={rowHeight}
                  maxVal={maxVal}
                  eventStyles={{
                    boxShadow: '0px 0px 4px rgba(0, 0, 0, 0.5)',
                    borderRadius: 2,
                    fontSize: rowHeight * 0.5,
                    border: '1px solid #FFFFFF10',
                  }}
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
}
