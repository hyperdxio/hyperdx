// Targeted unit test for the `<linearGradient>` defs union that backs
// `<Area url(#time-chart-lin-grad-…)>` lookups inside `MemoChart`. The
// helper is exported so we can pin the union/dedup behavior without
// rendering recharts in jsdom (which struggles with sized SVG
// containers). Covers the regression flagged in the deep review on
// #2362 where a semantic-hex `lineData[].color` (e.g. the output of
// `getChartColorInfo()` on HyperDX) would not have a matching gradient
// def after the `COLORS` palette was unified to Observable 10.
import { collectMemoChartGradientHexes } from '../HDXMultiSeriesTimeChart';
import { COLORS } from '../utils';

describe('collectMemoChartGradientHexes', () => {
  it('includes every categorical hex from COLORS up front', () => {
    const hexes = collectMemoChartGradientHexes([]);
    for (const c of COLORS) {
      expect(hexes).toContain(c);
    }
    expect(hexes).toHaveLength(COLORS.length);
  });

  it('unions in semantic hexes that lineData[].color introduces', () => {
    // `#00c28a` is HyperDX brand green — historically returned by
    // `getChartColorInfo()` for info-level series. After unifying
    // `COLORS` to Observable 10 it is no longer in the categorical
    // palette, so the gradient def must come from the lineData union.
    const semanticHex = '#00c28a';
    const hexes = collectMemoChartGradientHexes([{ color: semanticHex }]);
    expect(hexes).toContain(semanticHex);
    expect(hexes).toHaveLength(COLORS.length + 1);
  });

  it('dedupes a lineData hex that is already in COLORS', () => {
    const dup = COLORS[0];
    const hexes = collectMemoChartGradientHexes([
      { color: dup },
      { color: dup },
    ]);
    expect(hexes.filter(h => h === dup)).toHaveLength(1);
    expect(hexes).toHaveLength(COLORS.length);
  });

  it('filters out undefined and non-string colors', () => {
    // The downstream `c.replace('#', '')` would throw if `undefined`
    // sneaked through; this guards the defensive filter from being
    // accidentally removed.
    const hexes = collectMemoChartGradientHexes([
      { color: undefined },
      { color: '#abcdef' },
      // @ts-expect-error — intentionally exercising the runtime guard.
      { color: 42 },
    ]);
    expect(hexes).toContain('#abcdef');
    expect(hexes.every(h => typeof h === 'string')).toBe(true);
  });
});
