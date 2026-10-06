import { countsToPaletteIndexes } from '@/components/DBHeatmapChart/palette';

describe('countsToPaletteIndexes', () => {
  it('marks empty cells with -1', () => {
    expect(countsToPaletteIndexes([0, 0], 7)).toEqual([-1, -1]);
  });

  it('maps counts onto the palette by square root', () => {
    // p95 of [1, 4, 16] is 4, so sqrt(count) / 2 scales the palette
    expect(countsToPaletteIndexes([0, 1, 4, 16], 5)).toEqual([-1, 2, 4, 4]);
  });

  it('clamps cells above the p95 ceiling to the top color', () => {
    const counts = [...Array(99).fill(1), 1000];
    const indexes = countsToPaletteIndexes(counts, 7);
    expect(indexes[99]).toBe(6);
    expect(indexes[0]).toBe(6);
  });
});
