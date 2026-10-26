import { useCallback, useState } from 'react';
import type uPlot from 'uplot';
import { Tooltip } from '@mantine/core';

type AxisHover = { label: string; left: number; top: number };

/** The parts of uPlot and the mouse event the hover reads. */
type AxisPlot = Pick<uPlot, 'posToVal' | 'valToPos'> & {
  over: { getBoundingClientRect(): Pick<DOMRect, 'left' | 'top' | 'bottom'> };
};
type AxisMouseEvent = Pick<React.MouseEvent, 'clientX' | 'clientY'> & {
  currentTarget: { getBoundingClientRect(): Pick<DOMRect, 'left' | 'top'> };
};

/** Track which series-axis label the cursor is over, so its full name can be shown. */
export function useSeriesAxisHover(
  uplotRef: React.RefObject<AxisPlot | null>,
  labels: string[] | undefined,
) {
  const [hover, setHover] = useState<AxisHover | null>(null);

  const clear = useCallback(() => setHover(prev => (prev ? null : prev)), []);

  const onMouseMove = useCallback(
    (e: AxisMouseEvent) => {
      const u = uplotRef.current;
      if (labels == null || u == null) return clear();

      const over = u.over.getBoundingClientRect();
      const onAxis =
        e.clientX < over.left &&
        e.clientY >= over.top &&
        e.clientY <= over.bottom;
      const row = Math.floor(u.posToVal(e.clientY - over.top, 'y'));
      const rowLabel = onAxis ? labels[row] : undefined;
      if (rowLabel == null) return clear();
      const label = rowLabel === '' ? '(blank)' : rowLabel;

      const container = e.currentTarget.getBoundingClientRect();
      const top = u.valToPos(row + 0.5, 'y') + over.top - container.top;
      const left = e.clientX - container.left;
      setHover(prev =>
        prev?.label === label && prev.top === top ? prev : { label, left, top },
      );
    },
    [uplotRef, labels, clear],
  );

  return { hover, onMouseMove, clear };
}

/** The full name of the hovered series-axis label. */
export function SeriesAxisTooltip({ hover }: { hover: AxisHover | null }) {
  if (hover == null) return null;
  return (
    <Tooltip
      label={hover.label}
      opened
      position="top"
      multiline
      maw={600}
      styles={{ tooltip: { overflowWrap: 'anywhere' } }}
    >
      <div
        data-testid="heatmap-series-axis-tooltip-target"
        style={{
          position: 'absolute',
          left: hover.left,
          top: hover.top,
          width: 1,
          height: 1,
          pointerEvents: 'none',
        }}
      />
    </Tooltip>
  );
}
