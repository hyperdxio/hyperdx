import { cellsToPaletteIndexes } from '@/components/DBHeatmapChart/palette';

describe('cellsToPaletteIndexes: counts', () => {
  it('marks empty cells with -1', () => {
    expect(cellsToPaletteIndexes([0, 0], 7)).toEqual([-1, -1]);
  });

  it('maps counts onto the palette by square root', () => {
    // p95 of [1, 4, 16] is 4, so sqrt(count) / 2 scales the palette
    expect(cellsToPaletteIndexes([0, 1, 4, 16], 5)).toEqual([-1, 2, 4, 4]);
  });

  it('clamps cells above the p95 ceiling to the top color', () => {
    const counts = [...Array(99).fill(1), 1000];
    const indexes = cellsToPaletteIndexes(counts, 7);
    expect(indexes[99]).toBe(6);
    expect(indexes[0]).toBe(6);
  });
});

describe('cellsToPaletteIndexes: values', () => {
  it('marks non-finite cells with -1', () => {
    expect(cellsToPaletteIndexes([NaN, NaN], 7, 'value')).toEqual([-1, -1]);
  });

  it('scales up from the lowest value, including zero and negatives', () => {
    // Offsets from -4 are [0, 1, 4, 4]; p95 is 4, so sqrt(offset) / 2 scales
    expect(cellsToPaletteIndexes([-4, -3, 0, 0, NaN], 5, 'value')).toEqual([
      0, 2, 4, 4, -1,
    ]);
  });

  it('clamps values above the p95 ceiling to the top color', () => {
    const values = [-1, ...Array(98).fill(0), 1000];
    const indexes = cellsToPaletteIndexes(values, 7, 'value');
    expect(indexes[0]).toBe(0);
    expect(indexes[1]).toBe(6);
    expect(indexes[99]).toBe(6);
  });

  it('uses the bottom color when every value is the same', () => {
    expect(cellsToPaletteIndexes([-3, -3, NaN], 7, 'value')).toEqual([
      0, 0, -1,
    ]);
  });
});
