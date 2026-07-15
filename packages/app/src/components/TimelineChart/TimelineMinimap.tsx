import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActionIcon, Tooltip } from '@mantine/core';
import { IconZoomReset } from '@tabler/icons-react';

import type { TimelineViewportController } from './TimelineChart';
import type { TTimelineEvent } from './TimelineChartRowEvents';
import { getMaxEventValue, renderMs } from './utils';

import styles from './TimelineMinimap.module.scss';

type MinimapRow = {
  events: TTimelineEvent[];
};

type DragMode = 'pan' | 'resize-left' | 'resize-right' | 'brush' | null;

type TimelineMinimapProps = {
  rows: MinimapRow[];
  controller: TimelineViewportController | null;
};

const TICK_HEIGHT = 18;
const BAR_AREA_HEIGHT = 34;
const MINIMAP_HEIGHT = TICK_HEIGHT + BAR_AREA_HEIGHT;
// Pixel width of the grab zone on each side of the viewport for resize handles.
const HANDLE_HIT_AREA = 8;
const BAR_HEIGHT = 2;
// Below this brushed width (timeline fraction) a brush is treated as a click,
// not a zoom — avoids accidental extreme zooms on a stray drag.
const MIN_BRUSH_FRAC = 0.01;
// Smallest range a resize handle can produce; mirrors MIN_VIEWPORT_FRAC in
// TimelineChart so the two never disagree about the minimum window.
const MIN_RANGE_FRAC = 0.02;
// scale must exceed this to count as "zoomed" (guards float noise near 1).
const ZOOMED_EPSILON = 1.01;

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
  controller,
}: TimelineMinimapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const dragModeRef = useRef<DragMode>(null);
  const dragStartXRef = useRef(0);
  // Viewport at drag start, captured from the controller so pan/resize math is
  // relative to a stable origin even as the controller mutates mid-drag.
  const dragStartOffsetFracRef = useRef(0);
  const dragStartWidthFracRef = useRef(1);
  const brushStartFracRef = useRef(0);
  const brushRangeRef = useRef<{ start: number; end: number } | null>(null);

  const [brushRange, setBrushRange] = useState<{
    start: number;
    end: number;
  } | null>(null);

  // Local mirror of the chart's viewport, refreshed via the controller
  // subscription. Keeps the rectangle in sync with native scroll + wheel zoom
  // without re-rendering the (virtualized) waterfall rows.
  const [viewport, setViewport] = useState({
    offsetFrac: 0,
    widthFrac: 1,
    scale: 1,
  });

  useEffect(() => {
    if (!controller) return;
    const update = () => {
      const s = controller.getState();
      setViewport({
        offsetFrac: s.offsetFrac,
        widthFrac: s.viewportWidthFrac,
        scale: s.scale,
      });
    };
    update();
    return controller.subscribe(update);
  }, [controller]);

  const maxVal = useMemo(() => getMaxEventValue(rows), [rows]);

  const viewportStartFrac = viewport.offsetFrac;
  const viewportWidthFrac = viewport.widthFrac;
  const viewportEndFrac = Math.min(viewportStartFrac + viewportWidthFrac, 1);
  const isZoomed = viewport.scale > ZOOMED_EPSILON;

  const ticks = useMemo(() => {
    if (maxVal <= 0) return [];
    const TARGET_TICKS = 6;
    const rawInterval = maxVal / TARGET_TICKS;
    const magnitude = Math.pow(10, Math.floor(Math.log10(rawInterval)));
    let interval = magnitude;
    if (rawInterval >= 2 * magnitude) interval = 2 * magnitude;
    if (rawInterval >= 5 * magnitude) interval = 5 * magnitude;

    const result = [];
    for (let i = 0; ; i++) {
      const val = i * interval;
      const frac = val / maxVal;
      if (frac > 1) break;
      result.push({ val, frac, label: renderMs(val) });
    }
    return result;
  }, [maxVal]);

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      const el = containerRef.current;
      if (!el || !controller) return;

      e.preventDefault();
      e.stopPropagation();
      el.setPointerCapture(e.pointerId);

      const x = getXFraction(e.clientX, el);
      const handleFrac = HANDLE_HIT_AREA / el.getBoundingClientRect().width;

      const s = controller.getState();
      const startEdge = s.offsetFrac;
      const endEdge = Math.min(s.offsetFrac + s.viewportWidthFrac, 1);
      const zoomed = s.scale > ZOOMED_EPSILON;

      dragStartXRef.current = e.clientX;
      dragStartOffsetFracRef.current = s.offsetFrac;
      dragStartWidthFracRef.current = s.viewportWidthFrac;

      if (zoomed && Math.abs(x - startEdge) < handleFrac) {
        dragModeRef.current = 'resize-left';
      } else if (zoomed && Math.abs(x - endEdge) < handleFrac) {
        dragModeRef.current = 'resize-right';
      } else if (zoomed && x >= startEdge && x <= endEdge) {
        dragModeRef.current = 'pan';
      } else {
        dragModeRef.current = 'brush';
        brushStartFracRef.current = x;
        const range = { start: x, end: x };
        brushRangeRef.current = range;
        setBrushRange(range);
      }
    },
    [controller],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!dragModeRef.current || !controller) return;
      const el = containerRef.current;
      if (!el) return;

      const rect = el.getBoundingClientRect();

      if (dragModeRef.current === 'brush') {
        const x = getXFraction(e.clientX, el);
        const start = Math.min(brushStartFracRef.current, x);
        const end = Math.max(brushStartFracRef.current, x);
        const range = { start, end };
        brushRangeRef.current = range;
        setBrushRange(range);
        return;
      }

      const deltaFrac = (e.clientX - dragStartXRef.current) / rect.width;

      if (dragModeRef.current === 'pan') {
        const maxOffset = Math.max(0, 1 - dragStartWidthFracRef.current);
        const newOffset = Math.min(
          Math.max(dragStartOffsetFracRef.current + deltaFrac, 0),
          maxOffset,
        );
        controller.panToOffset(newOffset);
      } else if (dragModeRef.current === 'resize-left') {
        const currentStart = dragStartOffsetFracRef.current;
        const currentEnd = Math.min(
          currentStart + dragStartWidthFracRef.current,
          1,
        );
        const newStart = Math.max(
          0,
          Math.min(currentStart + deltaFrac, currentEnd - MIN_RANGE_FRAC),
        );
        controller.zoomToRange(newStart, currentEnd);
      } else if (dragModeRef.current === 'resize-right') {
        const currentStart = dragStartOffsetFracRef.current;
        const currentEnd = Math.min(
          currentStart + dragStartWidthFracRef.current,
          1,
        );
        const newEnd = Math.min(
          1,
          Math.max(currentEnd + deltaFrac, currentStart + MIN_RANGE_FRAC),
        );
        controller.zoomToRange(currentStart, newEnd);
      }
    },
    [controller],
  );

  const handlePointerUp = useCallback(() => {
    if (dragModeRef.current === 'brush' && controller) {
      const range = brushRangeRef.current;
      if (range && range.end - range.start > MIN_BRUSH_FRAC) {
        controller.zoomToRange(range.start, range.end);
      }
    }
    dragModeRef.current = null;
    brushRangeRef.current = null;
    setBrushRange(null);
  }, [controller]);

  const handleDoubleClick = useCallback(() => {
    if (controller && isZoomed) {
      controller.reset();
    }
  }, [controller, isZoomed]);

  const handleReset = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      controller?.reset();
    },
    [controller],
  );

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
      data-testid="timeline-minimap"
      onDoubleClick={handleDoubleClick}
      onPointerDown={handlePointerDown}
      onPointerMove={e => {
        handlePointerMove(e);
        if (!dragModeRef.current) {
          e.currentTarget.style.cursor = getCursor(e);
        } else if (dragModeRef.current === 'pan') {
          e.currentTarget.style.cursor = 'grabbing';
        } else if (dragModeRef.current === 'brush') {
          e.currentTarget.style.cursor = 'crosshair';
        } else {
          e.currentTarget.style.cursor = 'col-resize';
        }
      }}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
    >
      {ticks.map(({ val, frac, label }) => (
        <div
          key={val}
          className={styles.tick}
          style={{ left: `${frac * 100}%`, height: MINIMAP_HEIGHT }}
        >
          <span className={styles.tickLabel}>{label}</span>
        </div>
      ))}

      {maxVal > 0 &&
        rows.map((row, rowIdx) =>
          row.events.map(event => {
            const left = (event.start / maxVal) * 100;
            const width = Math.max(
              ((event.end - event.start) / maxVal) * 100,
              0.15,
            );
            return (
              <div
                key={event.id}
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

      {isZoomed && (
        <Tooltip label="Reset zoom" position="left" withArrow>
          <ActionIcon
            className={styles.resetButton}
            size="xs"
            variant="default"
            aria-label="Reset minimap zoom"
            onClick={handleReset}
            onPointerDown={e => e.stopPropagation()}
            onDoubleClick={e => e.stopPropagation()}
          >
            <IconZoomReset size={13} />
          </ActionIcon>
        </Tooltip>
      )}
    </div>
  );
});

TimelineMinimap.displayName = 'TimelineMinimap';
