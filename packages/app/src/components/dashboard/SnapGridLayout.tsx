import { useState } from 'react';
import RGL, { WidthProvider } from 'react-grid-layout';

import GridSnapOverlay, { type FocusRect } from './GridSnapOverlay';

const GridLayout = WidthProvider(RGL);

// Stable identities for the array defaults (an inline `[10, 10]` default would
// allocate a new array every render and can trip render-loop lint rules).
const DEFAULT_MARGIN: [number, number] = [10, 10];
const DEFAULT_CONTAINER_PADDING: [number, number] = [0, 0];

type GridLayoutProps = React.ComponentProps<typeof GridLayout>;
type ItemCallback = NonNullable<GridLayoutProps['onDrag']>;

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

  const toFocus = (item: { x: number; y: number; w: number; h: number }) => ({
    x: item.x,
    y: item.y,
    w: item.w,
    h: item.h,
  });

  const onStart =
    (base: ItemCallback | undefined): ItemCallback =>
    (layout, oldItem, newItem, ...args) => {
      setIsActive(true);
      if (newItem) setFocus(toFocus(newItem));
      base?.(layout, oldItem, newItem, ...args);
    };

  const onMove =
    (base: ItemCallback | undefined): ItemCallback =>
    (layout, oldItem, newItem, ...args) => {
      if (newItem) setFocus(toFocus(newItem));
      base?.(layout, oldItem, newItem, ...args);
    };

  const onStop =
    (base: ItemCallback | undefined): ItemCallback =>
    (...args) => {
      setIsActive(false);
      setFocus(null);
      base?.(...args);
    };

  return (
    <div style={{ position: 'relative' }}>
      {isActive && (
        <GridSnapOverlay
          cols={cols}
          rowHeight={rowHeight}
          margin={margin as [number, number]}
          containerPadding={containerPadding as [number, number]}
          focus={focus}
        />
      )}
      <GridLayout
        {...rest}
        cols={cols}
        rowHeight={rowHeight}
        margin={margin}
        containerPadding={containerPadding}
        onDragStart={onStart(onDragStart)}
        onDrag={onMove(onDrag)}
        onDragStop={onStop(onDragStop)}
        onResizeStart={onStart(onResizeStart)}
        onResize={onMove(onResize)}
        onResizeStop={onStop(onResizeStop)}
      >
        {children}
      </GridLayout>
    </div>
  );
}
