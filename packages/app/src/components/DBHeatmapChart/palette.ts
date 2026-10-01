import type uPlot from 'uplot';

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

/** Map each cell's count to a palette index, or -1 for empty cells. */
export function countsToPaletteIndexes(
  counts: number[],
  paletteSize: number,
): number[] {
  const dlen = counts.length;

  // Collect non-zero counts and sort to find a robust normalization ceiling.
  // Using p95 instead of max prevents a single hot cell from washing out the
  // rest of the chart, while still preserving cross-column comparability.
  const nonZero: number[] = [];
  for (let i = 0; i < dlen; i++) {
    if (counts[i] > 0) nonZero.push(counts[i]);
  }
  nonZero.sort((a, b) => a - b);

  const indexedFills = Array(dlen);

  if (nonZero.length === 0) {
    indexedFills.fill(-1);
    return indexedFills;
  }

  const p95Idx = Math.floor((nonZero.length - 1) * 0.95);
  const p95 = nonZero[p95Idx] ?? nonZero[nonZero.length - 1];
  const sqrtCeiling = Math.sqrt(p95);

  for (let i = 0; i < dlen; i++) {
    indexedFills[i] =
      counts[i] === 0
        ? -1
        : Math.max(
            Math.min(
              paletteSize - 1,
              Math.floor(
                (Math.sqrt(counts[i]) / (sqrtCeiling || 1)) * (paletteSize - 1),
              ),
            ),
            0,
          );
  }

  return indexedFills;
}

export function makeCountsToFills(colors: string[]) {
  return (u: uPlot, seriesIdx: number) =>
    // mode 2 data format is not supported in types properly
    countsToPaletteIndexes(
      u.data[seriesIdx][2] as unknown as number[],
      colors.length,
    );
}
