import {
  type PointerEvent as ReactPointerEvent,
  PointerEventHandler,
  useCallback,
} from 'react';

type UseDragHandlers = {
  onDragStart?: (e: ReactPointerEvent<HTMLDivElement>) => void;
  onDragMove?: (e: PointerEvent) => void;
  onDragEnd?: (e: PointerEvent) => void;
};

export const useDrag = ({
  onDragStart,
  onDragMove,
  onDragEnd,
}: UseDragHandlers) =>
  useCallback<PointerEventHandler<HTMLDivElement>>(
    e => {
      // only left click
      if (e.button !== 0) {
        return;
      }

      const abortController = new AbortController();

      document.addEventListener('pointermove', e => onDragMove?.(e), {
        signal: abortController.signal,
      });

      const handleEnd = (e: PointerEvent) => {
        abortController.abort();
        onDragEnd?.(e);
      };

      document.addEventListener('pointerup', handleEnd, {
        signal: abortController.signal,
      });

      document.addEventListener('pointercancel', handleEnd, {
        signal: abortController.signal,
      });

      onDragStart?.(e);
    },
    [onDragStart, onDragMove, onDragEnd],
  );
