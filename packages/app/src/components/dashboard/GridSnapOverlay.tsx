import { useLayoutEffect, useRef, useState } from 'react';

import {
  computeSnapCells,
  DEFAULT_CONTAINER_PADDING,
  DEFAULT_MARGIN,
  type FocusRect,
} from './gridSnap';

import styles from '@styles/GridSnapOverlay.module.scss';

export type { FocusRect };

type GridSnapOverlayProps = {
  /** Number of columns the grid snaps to (react-grid-layout `cols`). */
  cols: number;
  /** Pixel height of a single grid row (react-grid-layout `rowHeight`). */
  rowHeight: number;
  /** [horizontal, vertical] gap between cells (react-grid-layout `margin`). */
  margin?: [number, number];
  /** [horizontal, vertical] padding around the grid (react-grid-layout `containerPadding`). */
  containerPadding?: [number, number];
  /** Current tile position; its cells and their neighbors are highlighted. */
  focus?: FocusRect | null;
};

/**
 * A non-interactive overlay that draws the snap grid a dashboard tile lands on
 * while it is being dragged or resized. It outlines the actual snap cells (each
 * the footprint of a 1x1 tile), computed with the same geometry
 * react-grid-layout uses, and brightens the cells around the tile's current
 * position so the drop target is obvious.
 *
 * Rendered behind the tiles (tiles have opaque backgrounds), so occupied cells
 * stay covered and only the empty cells, the ones a tile can drop into, show
 * the grid. Sits inside a `position: relative` parent and fills it.
 */
export default function GridSnapOverlay({
  cols,
  rowHeight,
  margin = DEFAULT_MARGIN,
  containerPadding = DEFAULT_CONTAINER_PADDING,
  focus,
}: GridSnapOverlayProps) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState<{ width: number; height: number }>({
    width: 0,
    height: 0,
  });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const measure = () =>
      setSize({ width: el.clientWidth, height: el.clientHeight });
    measure();
    const obs = new ResizeObserver(measure);
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  const [marginX, marginY] = margin;
  const [padX, padY] = containerPadding;
  const { width, height } = size;

  const { cells, colWidth } = computeSnapCells({
    width,
    height,
    cols,
    rowHeight,
    marginX,
    marginY,
    padX,
    padY,
    focus,
  });

  return (
    <div ref={ref} className={styles.overlay} aria-hidden>
      {cells.length > 0 && (
        <svg className={styles.svg} width={width} height={height}>
          {cells.map(c => (
            <rect
              key={`${c.x}-${c.y}`}
              className={c.near ? styles.gridCellNear : styles.gridCell}
              x={c.x}
              y={c.y}
              width={colWidth}
              height={rowHeight}
              rx={2}
            />
          ))}
        </svg>
      )}
    </div>
  );
}
