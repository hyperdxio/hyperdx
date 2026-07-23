/** The dragged/resized tile's current position, in grid (column/row) units. */
export type FocusRect = { x: number; y: number; w: number; h: number };

/** A single snap cell in pixel space, plus whether it neighbors the focus. */
export type SnapCell = { x: number; y: number; near: boolean };

export type SnapCellsInput = {
  /** Overlay pixel size (matches the grid container). */
  width: number;
  height: number;
  /** react-grid-layout `cols`. */
  cols: number;
  /** react-grid-layout `rowHeight` (pixels). */
  rowHeight: number;
  /** react-grid-layout `margin` = [horizontal, vertical] gap between cells. */
  marginX: number;
  marginY: number;
  /** react-grid-layout `containerPadding` = [horizontal, vertical]. */
  padX: number;
  padY: number;
  /** Tile being dragged/resized; its cells and neighbors are flagged `near`. */
  focus?: FocusRect | null;
  /** Cells within this many cells of the focus footprint count as neighbors. */
  neighborRadius?: number;
};

/**
 * react-grid-layout column width: the usable width, minus the inter-column
 * margins and container padding, split across `cols`.
 */
export function computeSnapColWidth(
  width: number,
  cols: number,
  marginX: number,
  padX: number,
): number {
  return cols > 0 ? (width - marginX * (cols - 1) - padX * 2) / cols : 0;
}

/**
 * Compute the snap cells to draw behind the grid while a tile is dragged or
 * resized. Each cell is `colWidth x rowHeight`, the exact footprint of a 1x1
 * tile, positioned with the same geometry react-grid-layout uses so all four
 * edges of a dropped tile land on a cell edge (the margins show as the gaps
 * between cells). Column width mirrors RGL: the usable width, minus the
 * inter-column margins and container padding, split across `cols`.
 *
 * Pure and dependency-free so the alignment and neighbor math can be unit
 * tested without rendering.
 */
export function computeSnapCells({
  width,
  height,
  cols,
  rowHeight,
  marginX,
  marginY,
  padX,
  padY,
  focus,
  neighborRadius = 1,
}: SnapCellsInput): SnapCell[] {
  const colWidth = computeSnapColWidth(width, cols, marginX, padX);
  const colPitch = colWidth + marginX;
  const rowPitch = rowHeight + marginY;

  if (colWidth <= 0 || rowPitch <= 0 || width <= 0 || height <= 0) {
    return [];
  }

  const isNeighbor = (col: number, row: number) =>
    focus != null &&
    col >= focus.x - neighborRadius &&
    col <= focus.x + focus.w - 1 + neighborRadius &&
    row >= focus.y - neighborRadius &&
    row <= focus.y + focus.h - 1 + neighborRadius;

  const cells: SnapCell[] = [];
  for (let row = 0; padY + row * rowPitch + rowHeight <= height + 0.5; row++) {
    for (let col = 0; col < cols; col++) {
      cells.push({
        x: padX + col * colPitch,
        y: padY + row * rowPitch,
        near: isNeighbor(col, row),
      });
    }
  }
  return cells;
}
