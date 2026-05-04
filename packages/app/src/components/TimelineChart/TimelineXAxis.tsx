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
  height,
  scaleRef,
  ref,
}: {
  maxVal: number;
  labelWidth: number;
  height: number;
  scaleRef: RefObject<number>;
  ref: Ref<TimelineXAxisHandle>;
}) {
  const ticksContainerRef = useRef<HTMLDivElement>(null);

  const recompute = useCallback(() => {
    const container = ticksContainerRef.current;

    if (container == null) {
      return;
    }

    const scale = scaleRef.current ?? 1;
    const scaledMaxVal = maxVal / scale;
    const interval = calculateInterval(scaledMaxVal);
    const numTicks = Math.floor(maxVal / interval);
    const percSpacing = (interval / maxVal) * 100;

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
  }, [maxVal, height, scaleRef]);

  useImperativeHandle(ref, () => ({ recompute }), [recompute]);

  useLayoutEffect(() => {
    recompute();
  }, [recompute]);

  return (
    <div className={styles.xAxis}>
      <div className={styles.xAxisInner}>
        <div style={{ width: labelWidth, minWidth: labelWidth }}></div>
        <div ref={ticksContainerRef} className={styles.xAxisTicks}></div>
      </div>
    </div>
  );
}
