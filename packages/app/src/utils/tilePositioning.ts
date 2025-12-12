import { DisplayType } from '@hyperdx/common-utils/dist/types';

import { Tile } from '@/dashboard';

/**
 * Calculate the next available position for a new tile at the bottom of the dashboard
 * @param tiles - Array of existing tiles on the dashboard
 * @returns Position object with x and y coordinates
 */
export function calculateNextTilePosition(tiles: Tile[]): {
  x: number;
  y: number;
} {
  if (tiles.length === 0) {
    return { x: 0, y: 0 };
  }

  // Find the maximum bottom position (y + height) across all tiles
  const maxBottom = Math.max(...tiles.map(tile => tile.y + tile.h));

  return {
    x: 0, // Always start at left edge
    y: maxBottom, // Place at bottom of dashboard
  };
}

/**
 * Get default tile dimensions based on chart display type
 * @param displayType - The type of chart visualization
 * @returns Dimensions object with width (w) and height (h) in grid units
 */
export function getDefaultTileSize(displayType?: DisplayType): {
  w: number;
  h: number;
} {
  const GRID_COLS = 24; // Full width of dashboard grid

  switch (displayType) {
    case DisplayType.Line:
    case DisplayType.StackedBar:
      // Half-width time series charts
      return { w: 12, h: 10 };

    case DisplayType.Table:
    case DisplayType.Search:
      // Full-width data views
      return { w: GRID_COLS, h: 12 };

    case DisplayType.Number:
      // Small metric cards
      return { w: 6, h: 6 };

    case DisplayType.Markdown:
      // Medium-sized documentation blocks
      return { w: 12, h: 8 };

    case DisplayType.Heatmap:
      // Half-width heatmap
      return { w: 12, h: 10 };

    default:
      // Default to half-width time series size
      return { w: 12, h: 10 };
  }
}
