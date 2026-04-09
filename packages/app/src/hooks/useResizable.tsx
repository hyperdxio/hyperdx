import {
  MouseEvent as ReactMouseEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';

const MIN_PANEL_PERCENT = 10;
const MAX_PANEL_OFFSET_PX = 25;

type ResizeDirection = 'left' | 'right' | 'top' | 'bottom';

function useResizable(
  initialSizePercent: number,
  direction: ResizeDirection = 'right',
) {
  const [sizePercentage, setSizePercentage] = useState(initialSizePercent);

  // Track drag start
  const startPosRef = useRef(0);
  const startSizeRef = useRef(0);

  const isVertical = direction === 'top' || direction === 'bottom';
  const axis: 'clientX' | 'clientY' = isVertical ? 'clientY' : 'clientX';

  // For right/bottom, positive drag increases size; for left/top, it decreases.
  const directionMultiplier =
    direction === 'right' || direction === 'top' ? -1 : 1;

  const handleResize = useCallback(
    (e: globalThis.MouseEvent) => {
      const containerSize = isVertical ? window.innerHeight : window.innerWidth;
      const delta = e[axis] - startPosRef.current;
      const deltaPercent = (delta / containerSize) * 100;

      const offsetWidth = isVertical
        ? window.innerHeight
        : document.body.offsetWidth;
      // Clamp to min and max
      const maxPercent =
        ((offsetWidth - MAX_PANEL_OFFSET_PX) / containerSize) * 100;

      const minPercent = MIN_PANEL_PERCENT;

      const newSize = startSizeRef.current + deltaPercent * directionMultiplier;

      setSizePercentage(Math.min(Math.max(minPercent, newSize), maxPercent));
    },
    [isVertical, axis, directionMultiplier],
  );

  const endResize = useCallback(() => {
    document.removeEventListener('mousemove', handleResize);
    // eslint-disable-next-line react-hooks/immutability
    document.removeEventListener('mouseup', endResize);
  }, [handleResize]);

  const startResize = useCallback(
    (e: ReactMouseEvent<HTMLElement>) => {
      e.preventDefault();
      startPosRef.current = e[axis];
      startSizeRef.current = sizePercentage;
      document.addEventListener('mousemove', handleResize);
      document.addEventListener('mouseup', endResize);
    },
    [axis, sizePercentage, handleResize, endResize],
  );

  useEffect(() => {
    return () => {
      document.removeEventListener('mousemove', handleResize);
      document.removeEventListener('mouseup', endResize);
    };
  }, [handleResize, endResize]);

  return {
    size: sizePercentage,
    startResize,
  };
}

export default useResizable;
