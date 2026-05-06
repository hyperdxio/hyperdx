import { useCallback, useRef, useState } from 'react';

/** Minimum drag distance in pixels before treating the gesture as a zoom. */
const MIN_DRAG_PIXELS = 20;

type RechartsMouseEvent = {
  activeLabel?: string | number;
  chartX?: number;
};

/**
 * Encapsulates the brush-to-zoom interaction used on time-axis charts. The
 * caller provides the `onTimeRangeSelect` callback (a no-op when zoom is
 * unsupported) and wires the returned event handlers and `ReferenceArea`
 * coordinates into the Recharts chart.
 *
 * Matches the gesture semantics used in `HDXMultiSeriesTimeChart` so the
 * Timeline tile feels identical to other chart tiles.
 */
export function useBrushZoom(
  onTimeRangeSelect?: (start: Date, end: Date) => void,
) {
  const [highlightStart, setHighlightStart] = useState<string | undefined>();
  const [highlightEnd, setHighlightEnd] = useState<string | undefined>();
  const mouseDownPosRef = useRef<number | null>(null);

  const reset = useCallback(() => {
    setHighlightStart(undefined);
    setHighlightEnd(undefined);
    mouseDownPosRef.current = null;
  }, []);

  const onMouseDown = useCallback((e: RechartsMouseEvent | undefined) => {
    if (e?.activeLabel != null) {
      setHighlightStart(String(e.activeLabel));
      mouseDownPosRef.current = e.chartX ?? null;
    }
  }, []);

  const onMouseMove = useCallback(
    (e: RechartsMouseEvent | undefined) => {
      if (highlightStart != null && e?.activeLabel != null) {
        setHighlightEnd(String(e.activeLabel));
      }
    },
    [highlightStart],
  );

  const onMouseUp = useCallback(
    (e: RechartsMouseEvent | undefined) => {
      const downPx = mouseDownPosRef.current;
      const upPx = e?.chartX;
      const dragDistance =
        downPx != null && upPx != null ? Math.abs(upPx - downPx) : 0;

      if (
        highlightStart != null &&
        highlightEnd != null &&
        dragDistance >= MIN_DRAG_PIXELS &&
        onTimeRangeSelect != null
      ) {
        const startSec = Number.parseInt(highlightStart, 10);
        const endSec = Number.parseInt(highlightEnd, 10);
        if (Number.isFinite(startSec) && Number.isFinite(endSec)) {
          onTimeRangeSelect(
            new Date(Math.min(startSec, endSec) * 1000),
            new Date(Math.max(startSec, endSec) * 1000),
          );
        }
      }
      reset();
    },
    [highlightStart, highlightEnd, onTimeRangeSelect, reset],
  );

  const onMouseLeave = useCallback(() => {
    reset();
  }, [reset]);

  return {
    highlightStart,
    highlightEnd,
    onMouseDown,
    onMouseMove,
    onMouseUp,
    onMouseLeave,
  };
}
