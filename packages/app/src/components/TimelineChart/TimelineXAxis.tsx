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

export function TimelineXAxis({
  maxVal,
  labelWidth,
  heightRef,
  scaleRef,
  ref,
}: {
  maxVal: number;
  labelWidth: number;
  heightRef: RefObject<number>;
  scaleRef: RefObject<number>;
  ref: Ref<TimelineXAxisHandle>;
}) {
  const ticksContainerRef = useRef<HTMLDivElement>(null);

  // Mirrored synchronously during render so recompute (called imperatively
  // from the parent's wheel/resize handlers) cannot read a stale maxVal in
  // the gap between commit and the layout-effect tick. A useLayoutEffect
  // mirror would have the same gap we are trying to close.
  const maxValRef = useRef(maxVal);
  // eslint-disable-next-line react-hooks/refs
  maxValRef.current = maxVal;

  const recompute = useCallback(() => {
    const container = ticksContainerRef.current;

    if (container == null) {
      return;
    }

    const scale = scaleRef.current ?? 1;
    const height = heightRef.current ?? 0;
    const max = maxValRef.current;
    const scaledMaxVal = max / scale;
    const interval = calculateInterval(scaledMaxVal);
    const numTicks = Math.floor(max / interval);
    const percSpacing = (interval / max) * 100;

    while (container.children.length > numTicks) {
      container.removeChild(container.lastChild!);
    }

    while (container.children.length < numTicks) {
      const tick = document.createElement('div');
      tick.style.width = '1px';
      tick.style.marginRight = '-1px';
      tick.style.background = 'var(--color-border-muted)';
      const label = document.createElement('div');
      label.className = styles.xAxisTickLabel;
      tick.appendChild(label);
      container.appendChild(tick);
    }

    // Children are always the tick <div><div /></div> pairs we created above.
    for (let i = 0; i < numTicks; i++) {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      const tick = container.children[i] as HTMLDivElement;
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      const label = tick.firstElementChild as HTMLDivElement;
      tick.style.height = `${height}px`;
      tick.style.marginLeft = i === 0 ? '0' : `${percSpacing.toFixed(6)}%`;
      label.textContent = renderMs(i * interval);
    }
  }, [maxValRef, heightRef, scaleRef]);

  useImperativeHandle(ref, () => ({ recompute }), [recompute]);

  // Re-runs when maxVal changes so ticks are re-laid out for the new range.
  // recompute itself reads maxValRef.current, which is updated during render.
  useLayoutEffect(() => {
    recompute();
  }, [maxVal, recompute]);

  return (
    <div className={styles.xAxis}>
      <div className={styles.xAxisInner}>
        <div style={{ width: labelWidth, minWidth: labelWidth }}></div>
        <div ref={ticksContainerRef} className={styles.xAxisTicks}></div>
      </div>
    </div>
  );
}
