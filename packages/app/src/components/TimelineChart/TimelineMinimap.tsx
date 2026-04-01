import { memo, useCallback, useMemo, useRef, useState } from 'react';

import type { TTimelineEvent } from './TimelineChartRowEvents';
import { calculateInterval, renderMs } from './utils';

import styles from './TimelineMinimap.module.scss';

type MinimapRow = {
  events: TTimelineEvent[];
};

type DragMode = 'pan' | 'resize-left' | 'resize-right' | 'brush' | null;

type TimelineMinimapProps = {
  rows: MinimapRow[];
  maxVal: number;
  scale: number;
  offset: number;
  setOffset: (fn: (v: number) => number) => void;
  setScale: (fn: (v: number) => number) => void;
};

const TICK_HEIGHT = 18;
const BAR_AREA_HEIGHT = 34;
const MINIMAP_HEIGHT = TICK_HEIGHT + BAR_AREA_HEIGHT;
const HANDLE_HIT_AREA = 8;
const BAR_HEIGHT = 2;

function getXFraction(clientX: number, containerEl: HTMLDivElement): number {
  const rect = containerEl.getBoundingClientRect();
  return Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
}

const HandleGrip = ({ side }: { side: 'left' | 'right' }) => (
  <div
    className={`${styles.handleGrip} ${
      side === 'left' ? styles.handleGripLeft : styles.handleGripRight
    }`}
  >
    <div className={styles.handleGripLine} />
    <div className={styles.handleGripLine} />
  </div>
);

export const TimelineMinimap = memo(function ({
  rows,
  maxVal,
  scale,
  offset,
  setOffset,
  setScale,
}: TimelineMinimapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const dragMode = useRef<DragMode>(null);
  const dragStartX = useRef(0);
  const dragStartOffset = useRef(0);
  const dragStartScale = useRef(1);
  const brushStartFrac = useRef(0);
  const brushRangeRef = useRef<{ start: number; end: number } | null>(null);

  const [brushRange, setBrushRange] = useState<{
    start: number;
    end: number;
  } | null>(null);

  const viewportStartFrac = offset / 100;
  const viewportWidthFrac = 1 / scale;
  const viewportEndFrac = viewportStartFrac + viewportWidthFrac;
  const isZoomed = scale > 1.01;

  const ticks = useMemo(() => {
    const interval = calculateInterval(maxVal);
    const numTicks = Math.floor(maxVal / interval) + 1;
    const result = [];
    for (let i = 0; i < numTicks; i++) {
      const frac = (i * interval) / maxVal;
      if (frac > 1) break;
      result.push({ frac, label: renderMs(i * interval) });
    }
    return result;
  }, [maxVal]);

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      const el = containerRef.current;
      if (!el) return;

      e.preventDefault();
      e.stopPropagation();
      el.setPointerCapture(e.pointerId);

      const x = getXFraction(e.clientX, el);
      const handleFrac = HANDLE_HIT_AREA / el.getBoundingClientRect().width;

      if (isZoomed && Math.abs(x - viewportStartFrac) < handleFrac) {
        dragMode.current = 'resize-left';
      } else if (isZoomed && Math.abs(x - viewportEndFrac) < handleFrac) {
        dragMode.current = 'resize-right';
      } else if (x >= viewportStartFrac && x <= viewportEndFrac) {
        if (isZoomed) {
          dragMode.current = 'pan';
        } else {
          dragMode.current = 'brush';
          brushStartFrac.current = x;
          const range = { start: x, end: x };
          brushRangeRef.current = range;
          setBrushRange(range);
        }
      } else {
        dragMode.current = 'brush';
        brushStartFrac.current = x;
        const range = { start: x, end: x };
        brushRangeRef.current = range;
        setBrushRange(range);
      }

      dragStartX.current = e.clientX;
      dragStartOffset.current = offset;
      dragStartScale.current = scale;
    },
    [viewportStartFrac, viewportEndFrac, offset, scale, isZoomed],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!dragMode.current) return;
      const el = containerRef.current;
      if (!el) return;

      const rect = el.getBoundingClientRect();

      if (dragMode.current === 'brush') {
        const x = getXFraction(e.clientX, el);
        const start = Math.min(brushStartFrac.current, x);
        const end = Math.max(brushStartFrac.current, x);
        const range = { start, end };
        brushRangeRef.current = range;
        setBrushRange(range);
        return;
      }

      const deltaFrac = (e.clientX - dragStartX.current) / rect.width;

      if (dragMode.current === 'pan') {
        const newOffset = Math.min(
          Math.max(dragStartOffset.current + deltaFrac * 100, 0),
          100 - 100 / dragStartScale.current,
        );
        setOffset(() => newOffset);
      } else if (dragMode.current === 'resize-left') {
        const currentStartFrac = dragStartOffset.current / 100;
        const currentEndFrac = currentStartFrac + 1 / dragStartScale.current;
        const newStartFrac = Math.max(
          0,
          Math.min(currentStartFrac + deltaFrac, currentEndFrac - 0.02),
        );
        const newWidthFrac = currentEndFrac - newStartFrac;
        const newScale = 1 / newWidthFrac;
        setScale(() => Math.max(newScale, 1));
        setOffset(() =>
          Math.min(Math.max(newStartFrac * 100, 0), 100 - 100 / newScale),
        );
      } else if (dragMode.current === 'resize-right') {
        const currentStartFrac = dragStartOffset.current / 100;
        const currentEndFrac = currentStartFrac + 1 / dragStartScale.current;
        const newEndFrac = Math.min(
          1,
          Math.max(currentEndFrac + deltaFrac, currentStartFrac + 0.02),
        );
        const newWidthFrac = newEndFrac - currentStartFrac;
        const newScale = 1 / newWidthFrac;
        setScale(() => Math.max(newScale, 1));
        setOffset(() =>
          Math.min(Math.max(currentStartFrac * 100, 0), 100 - 100 / newScale),
        );
      }
    },
    [setOffset, setScale],
  );

  const handlePointerUp = useCallback(() => {
    if (dragMode.current === 'brush') {
      const range = brushRangeRef.current;
      if (range) {
        const width = range.end - range.start;
        if (width > 0.01) {
          const newScale = 1 / width;
          setScale(() => Math.max(newScale, 1));
          setOffset(() =>
            Math.min(
              Math.max(range.start * 100, 0),
              100 - 100 / Math.max(newScale, 1),
            ),
          );
        }
      }
    }
    dragMode.current = null;
    brushRangeRef.current = null;
    setBrushRange(null);
  }, [setScale, setOffset]);

  const getCursor = useCallback(
    (e: React.PointerEvent) => {
      if (!isZoomed) return 'crosshair';
      const el = containerRef.current;
      if (!el) return 'crosshair';
      const x = getXFraction(e.clientX, el);
      const handleFrac = HANDLE_HIT_AREA / el.getBoundingClientRect().width;

      if (Math.abs(x - viewportStartFrac) < handleFrac) return 'col-resize';
      if (Math.abs(x - viewportEndFrac) < handleFrac) return 'col-resize';
      if (x >= viewportStartFrac && x <= viewportEndFrac) return 'grab';
      return 'crosshair';
    },
    [viewportStartFrac, viewportEndFrac, isZoomed],
  );

  return (
    <div
      ref={containerRef}
      className={styles.container}
      style={{ height: MINIMAP_HEIGHT }}
      onPointerDown={handlePointerDown}
      onPointerMove={e => {
        handlePointerMove(e);
        if (!dragMode.current) {
          e.currentTarget.style.cursor = getCursor(e);
        } else if (dragMode.current === 'pan') {
          e.currentTarget.style.cursor = 'grabbing';
        } else if (dragMode.current === 'brush') {
          e.currentTarget.style.cursor = 'crosshair';
        } else {
          e.currentTarget.style.cursor = 'col-resize';
        }
      }}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
    >
      {ticks.map(({ frac, label }) => (
        <div
          key={label}
          className={styles.tick}
          style={{ left: `${frac * 100}%`, height: MINIMAP_HEIGHT }}
        >
          <span className={styles.tickLabel}>{label}</span>
        </div>
      ))}

      {rows.map((row, rowIdx) =>
        row.events.map(event => {
          const left = (event.start / maxVal) * 100;
          const width = Math.max(
            ((event.end - event.start) / maxVal) * 100,
            0.15,
          );
          return (
            <div
              key={`${rowIdx}-${event.id}`}
              className={styles.bar}
              style={{
                left: `${left}%`,
                width: `${width}%`,
                top:
                  TICK_HEIGHT +
                  2 +
                  Math.round(
                    (rowIdx / Math.max(rows.length, 1)) *
                      (BAR_AREA_HEIGHT - BAR_HEIGHT - 4),
                  ),
                height: BAR_HEIGHT,
                backgroundColor: event.backgroundColor,
              }}
            />
          );
        }),
      )}

      {isZoomed && (
        <>
          <div
            className={styles.dimmedOverlay}
            style={{ left: 0, width: `${viewportStartFrac * 100}%` }}
          />
          <div
            className={styles.dimmedOverlay}
            style={{ left: `${viewportEndFrac * 100}%`, right: 0 }}
          />
          <div
            className={styles.viewportFrame}
            style={{
              left: `${viewportStartFrac * 100}%`,
              width: `${viewportWidthFrac * 100}%`,
            }}
          >
            <HandleGrip side="left" />
            <HandleGrip side="right" />
          </div>
        </>
      )}

      {brushRange && (
        <div
          className={styles.brushOverlay}
          style={{
            left: `${brushRange.start * 100}%`,
            width: `${(brushRange.end - brushRange.start) * 100}%`,
          }}
        />
      )}
    </div>
  );
});

TimelineMinimap.displayName = 'TimelineMinimap';
