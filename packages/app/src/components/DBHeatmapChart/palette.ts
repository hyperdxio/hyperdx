import type uPlot from 'uplot';

import { type HeatmapCellKind, isEmptyHeatmapCell } from './heatmapGrid';

// Theme-specific palettes.  Red is deliberately avoided at the high end so
// it can be reserved for error overlays in the future.
// Dark theme: starts at a luminant indigo visible on dark bg, ends at bright amber.
// Light theme: starts at a saturated medium blue visible on white, ends at deep orange.
export const darkPalette = [
  '#7b6cf6', // indigo (low)
  '#5a9cf6', // sky blue
  '#38c9a0', // teal
  '#6cd44a', // green
  '#c4d629', // lime
  '#f0c528', // gold
  '#f5a623', // amber (high)
];
export const lightPalette = [
  '#2a6fb5', // medium blue (low)
  '#2a96a8', // teal
  '#33a85e', // green
  '#7db832', // lime
  '#c4a820', // dark gold
  '#e08a17', // orange
  '#d46a12', // deep orange (high)
];

/**
 * Map each cell to a palette index, or -1 for empty cells. Cells are scaled by
 * the square root of their distance from a floor: 0 for counts, the lowest
 * value for values (which may be zero or negative).
 */
export function cellsToPaletteIndexes(
  cells: number[],
  paletteSize: number,
  cellKind: HeatmapCellKind = 'count',
): number[] {
  let floor = 0;
  if (cellKind === 'value') {
    floor = Infinity;
    for (const v of cells) {
      if (!isEmptyHeatmapCell(v, cellKind) && v < floor) floor = v;
    }
  }

  // Sort the offsets to find a robust normalization ceiling. Using p95
  // instead of max prevents a single hot cell from washing out the rest of
  // the chart, while still preserving cross-column comparability.
  const offsets: number[] = [];
  for (const v of cells) {
    if (!isEmptyHeatmapCell(v, cellKind)) offsets.push(v - floor);
  }
  if (offsets.length === 0) {
    return cells.map(() => -1);
  }
  offsets.sort((a, b) => a - b);

  const p95Idx = Math.floor((offsets.length - 1) * 0.95);
  const p95 = offsets[p95Idx] ?? offsets[offsets.length - 1];
  const sqrtCeiling = Math.sqrt(p95);

  return cells.map(v =>
    isEmptyHeatmapCell(v, cellKind)
      ? -1
      : Math.max(
          Math.min(
            paletteSize - 1,
            Math.floor(
              (Math.sqrt(v - floor) / (sqrtCeiling || 1)) * (paletteSize - 1),
            ),
          ),
          0,
        ),
  );
}

export function makeCellsToFills(colors: string[], cellKind: HeatmapCellKind) {
  return (u: uPlot, seriesIdx: number) =>
    // mode 2 data format is not supported in types properly
    cellsToPaletteIndexes(
      u.data[seriesIdx][2] as unknown as number[],
      colors.length,
      cellKind,
    );
}
