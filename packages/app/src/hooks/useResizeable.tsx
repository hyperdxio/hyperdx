import {
  MouseEvent as ReactMouseEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';

const MIN_PANEL_WIDTH_PERCENT = 10; // Minimum 10% of window width
const MAX_PANEL_OFFSET = 25; // Pixels to reserve on the right
const CURSOR_OFFSET = 3; // Pixels to offset cursor into panel

type ResizeDirection = 'left' | 'right';

function useResizable(
  initialWidthPercent: number,
  direction: ResizeDirection = 'right',
) {
  const [widthPercent, setWidthPercent] = useState(initialWidthPercent);
  const startPosRef = useRef(0);
  const startWidthRef = useRef(0);

  const handleResize = useCallback(
    (e: globalThis.MouseEvent) => {
      const delta = e.clientX - startPosRef.current;
      const deltaPercent = (delta / window.innerWidth) * 100;
      const directionMultiplier = direction === 'right' ? -1 : 1;

      const newWidth =
        startWidthRef.current + deltaPercent * directionMultiplier;
      const maxWidth =
        ((document.body.offsetWidth - MAX_PANEL_OFFSET) / window.innerWidth) *
        100;

      setWidthPercent(
        Math.min(Math.max(MIN_PANEL_WIDTH_PERCENT, newWidth), maxWidth),
      );
    },
    [direction],
  );

  const endResize = useCallback(() => {
    document.removeEventListener('mousemove', handleResize);
    document.removeEventListener('mouseup', endResize);
  }, [handleResize]);

  const startResize = useCallback(
    (e: ReactMouseEvent<HTMLElement>) => {
      e.preventDefault();
      startPosRef.current = e.clientX;
      startWidthRef.current = widthPercent;
      document.addEventListener('mousemove', handleResize);
      document.addEventListener('mouseup', endResize);
    },
    [widthPercent, handleResize, endResize],
  );

  // Cleanup event listeners on unmount
  useEffect(() => {
    return () => {
      document.removeEventListener('mousemove', handleResize);
      document.removeEventListener('mouseup', endResize);
    };
  }, [handleResize, endResize]);

  return { width: widthPercent, startResize };
}

export default useResizable;
