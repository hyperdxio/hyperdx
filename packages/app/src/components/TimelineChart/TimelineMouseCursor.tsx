import {
  type Ref,
  type RefObject,
  useEffect,
  useImperativeHandle,
  useRef,
} from 'react';

import { useStableCallback } from '@/hooks/useStableCallback';

import { renderMs } from './utils';

import styles from './TimelineChart.module.scss';

export type TimelineMouseCursorHandle = {
  recompute: () => void;
};

export function TimelineMouseCursor({
  containerRef,
  maxVal,
  labelWidth,
  height,
  scaleRef,
  ref,
}: {
  containerRef: RefObject<HTMLDivElement | null>;
  maxVal: number;
  labelWidth: number;
  height: number;
  scaleRef: RefObject<number>;
  ref: Ref<TimelineMouseCursorHandle>;
}) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const cursorRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const labelRef = useRef<HTMLSpanElement>(null);

  // Last known mouse X relative to the container's left edge — kept in a
  // ref so we can recompute `time` on scroll without depending on the
  // mousemove event firing again.
  const lastMouseXRef = useRef<number | null>(null);
  const isInsideRef = useRef(false);

  const recompute = useStableCallback(() => {
    const container = containerRef.current;
    const wrapper = wrapperRef.current;
    const cursor = cursorRef.current;
    const overlay = overlayRef.current;
    const label = labelRef.current;

    if (
      !container ||
      !wrapper ||
      !cursor ||
      !overlay ||
      !label ||
      lastMouseXRef.current == null
    ) {
      return;
    }

    const x = lastMouseXRef.current;
    const { scrollLeft, clientWidth } = container;

    // Visible-area fraction — used to determine visibility and overlay flip.
    const xPerc = (x - labelWidth) / (clientWidth - labelWidth);

    // Time uses absolute position within the full (scaled) events content,
    // including the horizontal scroll offset. The label column is sticky at
    // a fixed width regardless of scale, so events content width is
    // `clientWidth * scale - labelWidth`.
    const scale = scaleRef.current ?? 1;
    const eventsContentWidth = clientWidth * scale - labelWidth;
    const time = ((x - labelWidth + scrollLeft) / eventsContentWidth) * maxVal;

    const visible = isInsideRef.current && xPerc > 0;
    wrapper.style.display = visible ? 'block' : 'none';

    if (!visible) {
      return;
    }

    // The events column has `position: relative` and `overflow: hidden`, so
    // we position in pixels and use transform to avoid triggering layout.
    const cursorPx = x - labelWidth; // = xPerc * (clientWidth - labelWidth)
    cursor.style.transform = `translateX(${cursorPx.toFixed(2)}px)`;
    overlay.style.transform = `translateX(${xPerc < 0.5 ? 12 : -150}px)`;
    label.textContent = renderMs(Math.max(time, 0));
  });

  const onMouseMove = useStableCallback((e: MouseEvent) => {
    const timelineContainer = containerRef.current;
    if (timelineContainer == null) {
      return;
    }

    const rect = timelineContainer.getBoundingClientRect();
    lastMouseXRef.current = e.clientX - rect.left;
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

    element.addEventListener('mousemove', onMouseMove);
    element.addEventListener('mouseleave', onMouseLeave);
    element.addEventListener('mouseenter', onMouseEnter);
    element.addEventListener('scroll', recompute);

    return () => {
      element.removeEventListener('mousemove', onMouseMove);
      element.removeEventListener('mouseleave', onMouseLeave);
      element.removeEventListener('mouseenter', onMouseEnter);
      element.removeEventListener('scroll', recompute);
    };
  }, [containerRef, onMouseMove, onMouseLeave, onMouseEnter, recompute]);

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
            <div className={styles.mouseCursorLine} style={{ height }} />
          </div>
        </div>
      </div>
    </div>
  );
}
