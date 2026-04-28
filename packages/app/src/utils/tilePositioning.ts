import { DisplayType } from '@hyperdx/common-utils/dist/types';

import { Tile } from '@/dashboard';

const GRID_COLS = 24;

/**
 * Generate a unique ID for tiles, containers, and tabs.
 * Uses two random values concatenated for lower collision risk.
 * `.slice(2)` strips the leading "0." from `Math.random().toString(36)`.
 */
export const makeId = () =>
  Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);

/**
 * Calculate the next available position for a new tile, filling right
 * then wrapping to the next row (like text in a book).
 *
 * Scans each row from top to bottom. For each row, checks if there's
 * enough horizontal space to fit the new tile. If so, returns that
 * position. If no row has space, places at the bottom-left.
 *
 * @param tiles - Existing tiles in the target grid
 * @param newW - Width of the new tile in grid columns
 * @returns Position `{ x, y }` in grid coordinates
 */
export function calculateNextTilePosition(
  tiles: Tile[],
  newW: number,
): { x: number; y: number } {
  if (tiles.length === 0) {
    return { x: 0, y: 0 };
  }

  // Build a set of occupied rows and find the max bottom
  const rows = new Set<number>();
  let maxBottom = 0;
  for (const tile of tiles) {
    rows.add(tile.y);
    maxBottom = Math.max(maxBottom, tile.y + tile.h);
  }

  // Check each existing row for horizontal space
  const sortedRows = Array.from(rows).sort((a, b) => a - b);
  for (const rowY of sortedRows) {
    // Find tiles on this row
    const rowTiles = tiles.filter(t => t.y <= rowY && t.y + t.h > rowY);
    // Calculate rightmost occupied x on this row
    let rightEdge = 0;
    for (const t of rowTiles) {
      rightEdge = Math.max(rightEdge, t.x + t.w);
    }
    // Check if new tile fits to the right
    if (rightEdge + newW <= GRID_COLS) {
      return { x: rightEdge, y: rowY };
    }
  }

  // No row has space — place at bottom-left
  return { x: 0, y: maxBottom };
}

/**
 * Get default tile dimensions based on chart display type.
 *
 * @param displayType - The type of chart visualization
 * @returns Dimensions `{ w, h }` in grid units
 */
export function getDefaultTileSize(displayType?: DisplayType): {
  w: number;
  h: number;
} {
  switch (displayType) {
    case DisplayType.Line:
    case DisplayType.StackedBar:
    case DisplayType.Bar:
      return { w: 12, h: 10 };

    case DisplayType.Table:
    case DisplayType.Search:
      return { w: GRID_COLS, h: 12 };

    case DisplayType.Number:
      return { w: 6, h: 6 };

    case DisplayType.Markdown:
      return { w: 12, h: 8 };

    case DisplayType.Heatmap:
      return { w: 12, h: 10 };

    default:
      return { w: 12, h: 10 };
  }
}
