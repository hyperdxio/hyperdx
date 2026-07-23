import { useCallback, useMemo, useState } from 'react';
import RGL, { WidthProvider } from 'react-grid-layout';

import {
  DEFAULT_CONTAINER_PADDING,
  DEFAULT_MARGIN,
  type FocusRect,
} from './gridSnap';
import GridSnapOverlay from './GridSnapOverlay';

const GridLayout = WidthProvider(RGL);

type GridLayoutProps = React.ComponentProps<typeof GridLayout>;
type ItemCallback = NonNullable<GridLayoutProps['onDrag']>;

type Phase = 'start' | 'move' | 'stop';

const toFocus = (item: {
  x: number;
  y: number;
  w: number;
  h: number;
}): FocusRect => ({
  x: item.x,
  y: item.y,
  w: item.w,
  h: item.h,
});

/**
 * Drop-in replacement for the dashboard's `WidthProvider(ReactGridLayout)` that
 * shows the snap grid while a tile is being dragged or resized, then hides it on
 * drop. All react-grid-layout props pass straight through; the only added
 * behavior is the overlay, the drag/resize lifecycle that toggles it, and the
 * live tile position it highlights.
 *
 * The overlay reads the same `cols` / `rowHeight` / `margin` / `containerPadding`
 * the grid uses, so its guides match where tiles actually snap, and it brightens
 * the cells around the tile's current position so the drop target is obvious.
 */
export default function SnapGridLayout({
  children,
  onDragStart,
  onDrag,
  onDragStop,
  onResizeStart,
  onResize,
  onResizeStop,
  cols = 12,
  rowHeight = 150,
  margin = DEFAULT_MARGIN,
  containerPadding = DEFAULT_CONTAINER_PADDING,
  ...rest
}: GridLayoutProps) {
  const [isActive, setIsActive] = useState(false);
  const [focus, setFocus] = useState<FocusRect | null>(null);

  // Wrap a caller's drag/resize handler so the overlay tracks the tile, then
  // delegate to the original with its arguments untouched. Stable: it only
  // closes over the setState functions.
  const makeHandler = useCallback(
    (phase: Phase, base: ItemCallback | undefined): ItemCallback =>
      (layout, oldItem, newItem, ...args) => {
        if (phase === 'stop') {
          setIsActive(false);
          setFocus(null);
        } else {
          if (phase === 'start') setIsActive(true);
          if (newItem) setFocus(toFocus(newItem));
        }
        base?.(layout, oldItem, newItem, ...args);
      },
    [],
  );

  const handleDragStart = useMemo(
    () => makeHandler('start', onDragStart),
    [makeHandler, onDragStart],
  );
  const handleDrag = useMemo(
    () => makeHandler('move', onDrag),
    [makeHandler, onDrag],
  );
  const handleDragStop = useMemo(
    () => makeHandler('stop', onDragStop),
    [makeHandler, onDragStop],
  );
  const handleResizeStart = useMemo(
    () => makeHandler('start', onResizeStart),
    [makeHandler, onResizeStart],
  );
  const handleResize = useMemo(
    () => makeHandler('move', onResize),
    [makeHandler, onResize],
  );
  const handleResizeStop = useMemo(
    () => makeHandler('stop', onResizeStop),
    [makeHandler, onResizeStop],
  );

  return (
    <div style={{ position: 'relative' }}>
      {isActive && (
        <GridSnapOverlay
          cols={cols}
          rowHeight={rowHeight}
          margin={margin}
          containerPadding={containerPadding}
          focus={focus}
        />
      )}
      <GridLayout
        {...rest}
        cols={cols}
        rowHeight={rowHeight}
        margin={margin}
        containerPadding={containerPadding}
        onDragStart={handleDragStart}
        onDrag={handleDrag}
        onDragStop={handleDragStop}
        onResizeStart={handleResizeStart}
        onResize={handleResize}
        onResizeStop={handleResizeStop}
      >
        {children}
      </GridLayout>
    </div>
  );
}
