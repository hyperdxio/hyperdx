import {
  type Ref,
  type RefObject,
  useCallback,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
} from 'react';

import { calculateInterval, renderMs } from './utils';

import styles from './TimelineChart.module.scss';

export type TimelineXAxisHandle = {
  recompute: () => void;
};

// Minimum horizontal space reserved per tick label. The widest label we render
// (e.g. "1.234s") is ~45px; the extra headroom keeps adjacent labels from
// touching. Tune up for a sparser axis, down for a denser one.
const MIN_TICK_PX = 56;

export function TimelineXAxis({
  maxVal,
  labelWidth,
  heightRef,
  ref,
}: {
  maxVal: number;
  labelWidth: number;
  heightRef: RefObject<number>;
  ref: Ref<TimelineXAxisHandle>;
}) {
  // Two tick containers laid out from the same spacing computation so their
  // children stay column-aligned: the grid container holds the full-height
  // vertical lines (painted behind rows), the label container holds the time
  // labels (painted above rows in the sticky header).
  const gridTicksRef = useRef<HTMLDivElement>(null);
  const labelTicksRef = useRef<HTMLDivElement>(null);

  // Mirrored synchronously during render so recompute (called imperatively
  // from the parent's wheel/resize handlers) cannot read a stale maxVal in
  // the gap between commit and the layout-effect tick. A useLayoutEffect
  // mirror would have the same gap we are trying to close.
  const maxValRef = useRef(maxVal);
  // eslint-disable-next-line react-hooks/refs
  maxValRef.current = maxVal;

  const recompute = useCallback(() => {
    const gridContainer = gridTicksRef.current;
    const labelContainer = labelTicksRef.current;

    if (gridContainer == null || labelContainer == null) {
      return;
    }

    const height = heightRef.current ?? 0;
    const max = maxValRef.current;

    // Budget ticks by the pixels actually available. The ticks container spans
    // the (zoom-scaled) events area, so dividing its width by a minimum label
    // width gives how many labels fit without overlapping. Measuring here keeps
    // the axis correct on both panel resize and zoom, since both re-invoke
    // recompute after the layout/scale has changed. Both containers span the
    // same width, so measure one and drive both from the same spacing.
    const ticksWidthPx = gridContainer.getBoundingClientRect().width;
    const maxTicks = Math.max(1, Math.floor(ticksWidthPx / MIN_TICK_PX));
    const interval = calculateInterval(max, maxTicks);
    const numTicks = Math.floor(max / interval);
    const percSpacing = (interval / max) * 100;
    const marginLeft = (i: number) =>
      i === 0 ? '0' : `${percSpacing.toFixed(6)}%`;

    // Grid layer: full-height vertical lines only, painted behind the rows.
    while (gridContainer.children.length > numTicks) {
      gridContainer.removeChild(gridContainer.lastChild!);
    }
    while (gridContainer.children.length < numTicks) {
      const line = document.createElement('div');
      line.style.width = '1px';
      line.style.marginRight = '-1px';
      line.style.background = 'var(--color-border-muted)';
      gridContainer.appendChild(line);
    }
    for (let i = 0; i < numTicks; i++) {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      const line = gridContainer.children[i] as HTMLDivElement;
      line.style.height = `${height}px`;
      line.style.marginLeft = marginLeft(i);
    }

    // Header layer: time labels only, painted above the rows. Each entry is a
    // 1px-wide spacer div (no background line) so it column-aligns with the
    // matching grid line while leaving the vertical line to the grid layer.
    while (labelContainer.children.length > numTicks) {
      labelContainer.removeChild(labelContainer.lastChild!);
    }
    while (labelContainer.children.length < numTicks) {
      const tick = document.createElement('div');
      tick.style.width = '1px';
      tick.style.marginRight = '-1px';
      const label = document.createElement('div');
      label.className = styles.xAxisTickLabel;
      tick.appendChild(label);
      labelContainer.appendChild(tick);
    }
    // Children are always the tick <div><div /></div> pairs we created above.
    for (let i = 0; i < numTicks; i++) {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      const tick = labelContainer.children[i] as HTMLDivElement;
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      const label = tick.firstElementChild as HTMLDivElement;
      tick.style.marginLeft = marginLeft(i);
      label.textContent = renderMs(i * interval, interval);
    }
  }, [maxValRef, heightRef]);

  useImperativeHandle(ref, () => ({ recompute }), [recompute]);

  // Re-runs when maxVal changes so ticks are re-laid out for the new range.
  // recompute itself reads maxValRef.current, which is updated during render.
  useLayoutEffect(() => {
    recompute();
  }, [maxVal, recompute]);

  return (
    <>
      {/* Full-height vertical grid lines. No z-index + rendered before the
          rows so the rows paint on top, keeping the lines behind row bars,
          duration labels, and span-body text. */}
      <div className={styles.xAxisGrid}>
        <div className={styles.xAxisGridInner}>
          <div style={{ width: labelWidth, minWidth: labelWidth }}></div>
          <div ref={gridTicksRef} className={styles.xAxisTicks}></div>
        </div>
      </div>

      {/* Sticky header with the time labels. z-index keeps it above the rows
          so labels stay visible while rows scroll underneath. */}
      <div className={styles.xAxis}>
        <div className={styles.xAxisInner}>
          <div style={{ width: labelWidth, minWidth: labelWidth }}></div>
          <div ref={labelTicksRef} className={styles.xAxisTicks}></div>
        </div>
      </div>
    </>
  );
}
