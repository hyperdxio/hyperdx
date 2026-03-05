import { RefObject, useEffect, useState } from 'react';

import { TimelineCursor } from './TimelineCursor';
import { renderMs } from './utils';

export function TimelineMouseCursor({
  containerRef,
  maxVal,
  labelWidth,
  height,
  scale,
  offset,
  xPerc,
  setXPerc,
}: {
  containerRef: RefObject<HTMLDivElement | null>;
  maxVal: number;
  labelWidth: number;
  height: number;
  scale: number;
  offset: number;
  xPerc: number;
  setXPerc: (p: number) => void;
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
      color="var(--color-bg-neutral)"
    />
  ) : null;
}
