import {
  type Ref,
  type RefObject,
  useEffect,
  useImperativeHandle,
  useRef,
} from 'react';

import { useStableCallback } from '@/hooks/useStableCallback';

import { renderMs, tickIntervalForWidth } from './utils';

import styles from './TimelineChart.module.scss';

export type TimelineMouseCursorHandle = {
  recompute: () => void;
};

export function TimelineMouseCursor({
  containerRef,
  maxVal,
  labelWidth,
  heightRef,
  scaleRef,
  ref,
}: {
  containerRef: RefObject<HTMLDivElement | null>;
  maxVal: number;
  labelWidth: number;
  heightRef: RefObject<number>;
  scaleRef: RefObject<number>;
  ref: Ref<TimelineMouseCursorHandle>;
}) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const cursorRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const labelRef = useRef<HTMLSpanElement>(null);
  const lineRef = useRef<HTMLDivElement>(null);

  // Mirror props into refs synchronously during render so flushRecompute
  // (wrapped in useStableCallback, which syncs via useLayoutEffect) cannot
  // read stale values if a mousemove/scroll event fires before the
  // layout-effect tick. A useLayoutEffect mirror would have the same gap
  // we are trying to close.
  const labelWidthRef = useRef(labelWidth);
  // eslint-disable-next-line react-hooks/refs
  labelWidthRef.current = labelWidth;
  const maxValRef = useRef(maxVal);
  // eslint-disable-next-line react-hooks/refs
  maxValRef.current = maxVal;

  // Last known mouse clientX — resolved against the container's bounding
  // rect inside the rAF flush so the layout read happens once per frame
  // rather than on every mousemove.
  const lastClientXRef = useRef<number | null>(null);
  const isInsideRef = useRef(false);
  const rafIdRef = useRef<number | null>(null);

  const flushRecompute = useStableCallback(() => {
    rafIdRef.current = null;

    const container = containerRef.current;
    const wrapper = wrapperRef.current;
    const cursor = cursorRef.current;
    const overlay = overlayRef.current;
    const label = labelRef.current;
    const line = lineRef.current;

    if (
      !container ||
      !wrapper ||
      !cursor ||
      !overlay ||
      !label ||
      !line ||
      lastClientXRef.current == null
    ) {
      return;
    }

    const rect = container.getBoundingClientRect();
    const x = lastClientXRef.current - rect.left;
    const { scrollLeft, clientWidth } = container;
    const labelW = labelWidthRef.current;

    // Visible-area fraction — used to determine visibility and overlay flip.
    const xPerc = (x - labelW) / (clientWidth - labelW);

    // Time uses absolute position within the full (scaled) events content,
    // including the horizontal scroll offset. The label column is sticky at
    // a fixed width regardless of scale, so events content width is
    // `clientWidth * scale - labelW`.
    const scale = scaleRef.current ?? 1;
    const eventsContentWidth = Math.max(1, clientWidth * scale - labelW);
    const time =
      ((x - labelW + scrollLeft) / eventsContentWidth) * maxValRef.current;

    const visible = isInsideRef.current && xPerc > 0;
    wrapper.style.display = visible ? 'block' : 'none';

    if (!visible) {
      return;
    }

    // The events column has `position: relative` and `overflow: hidden`, so
    // we position in pixels and use transform to avoid triggering layout.
    const cursorPx = x - labelW; // = xPerc * (clientWidth - labelW)
    cursor.style.transform = `translateX(${cursorPx.toFixed(2)}px)`;
    overlay.style.transform = `translateX(${xPerc < 0.5 ? 12 : -150}px)`;
    // Format with the same tick interval the X-axis derives from this width, so
    // the readout carries the same precision (and unit) as the tick labels.
    const interval = tickIntervalForWidth(
      maxValRef.current,
      eventsContentWidth,
    );
    label.textContent = renderMs(Math.max(time, 0), interval);
    line.style.height = `${heightRef.current ?? 0}px`;
  });

  // Coalesces multiple events in the same frame into a single read+write pass.
  const recompute = useStableCallback(() => {
    if (rafIdRef.current != null) {
      return;
    }
    rafIdRef.current = requestAnimationFrame(flushRecompute);
  });

  const onMouseMove = useStableCallback((e: MouseEvent) => {
    lastClientXRef.current = e.clientX;
    recompute();
  });

  const onMouseEnter = useStableCallback(() => {
    isInsideRef.current = true;
    recompute();
  });

  const onMouseLeave = useStableCallback(() => {
    isInsideRef.current = false;
    recompute();
  });

  useEffect(() => {
    const element = containerRef.current;

    if (element == null) {
      return;
    }

    element.addEventListener('mousemove', onMouseMove, { passive: true });
    element.addEventListener('mouseleave', onMouseLeave);
    element.addEventListener('mouseenter', onMouseEnter);
    element.addEventListener('scroll', recompute, { passive: true });

    return () => {
      element.removeEventListener('mousemove', onMouseMove);
      element.removeEventListener('mouseleave', onMouseLeave);
      element.removeEventListener('mouseenter', onMouseEnter);
      element.removeEventListener('scroll', recompute);
    };
  }, [containerRef, onMouseMove, onMouseLeave, onMouseEnter, recompute]);

  useEffect(() => {
    return () => {
      if (rafIdRef.current != null) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }
    };
  }, []);

  useImperativeHandle(ref, () => ({ recompute }), [recompute]);

  return (
    <div
      ref={wrapperRef}
      className={styles.mouseCursorWrapper}
      style={{ display: 'none' }}
    >
      <div className={styles.mouseCursorRow}>
        <div style={{ width: labelWidth, minWidth: labelWidth }} />
        <div className={styles.mouseCursorEventsColumn}>
          <div ref={cursorRef} className={styles.mouseCursor}>
            <div ref={overlayRef} className={styles.mouseCursorOverlay}>
              <div>
                <span ref={labelRef} className={styles.mouseCursorLabel} />
              </div>
            </div>
            <div ref={lineRef} className={styles.mouseCursorLine} />
          </div>
        </div>
      </div>
    </div>
  );
}
