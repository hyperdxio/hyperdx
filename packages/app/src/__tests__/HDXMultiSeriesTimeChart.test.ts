// Targeted unit test for the `<linearGradient>` defs union that backs
// `<Area url(#time-chart-lin-grad-…)>` lookups inside `MemoChart`. The
// helper is exported so we can pin the union/dedup behavior without
// rendering recharts in jsdom (which struggles with sized SVG
// containers). Covers the regression flagged in the deep review on
// #2362 where a semantic-hex `lineData[].color` (e.g. the output of
// `getChartColorInfo()` on HyperDX) would not have a matching gradient
// def after the `COLORS` palette was unified to Observable 10.
import type { LineData } from '@/ChartUtils';
import {
  buildActiveClickSeries,
  collectMemoChartGradientHexes,
  getVisibleLineData,
  HARD_LINES_LIMIT,
  selectTooltipRows,
} from '@/HDXMultiSeriesTimeChart';
import { COLORS } from '@/utils';

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

// The drill-down click popover rebuilds its per-series payload from the same
// set of series that are actually drawn. These tests pin that "visible set"
// logic so the popover can never surface legend-deselected or over-limit
// series (the Recharts 2 `state.activePayload` only ever contained drawn
// series).
describe('getVisibleLineData', () => {
  const makeLine = (dataKey: string, displayName?: string): LineData => ({
    dataKey,
    currentPeriodKey: dataKey,
    previousPeriodKey: `${dataKey}.prev`,
    displayName: displayName ?? dataKey,
    valueColumnName: dataKey,
    color: '#abcdef',
  });

  it('returns all series (up to the limit) when there is no selection', () => {
    const lineData = [makeLine('a'), makeLine('b'), makeLine('c')];
    expect(getVisibleLineData(lineData, undefined).map(l => l.dataKey)).toEqual(
      ['a', 'b', 'c'],
    );
    expect(getVisibleLineData(lineData, new Set()).map(l => l.dataKey)).toEqual(
      ['a', 'b', 'c'],
    );
  });

  it('keeps only the selected series (matched by display name)', () => {
    const lineData = [
      makeLine('a', 'Alpha'),
      makeLine('b', 'Beta'),
      makeLine('c', 'Gamma'),
    ];
    const visible = getVisibleLineData(lineData, new Set(['Alpha', 'Gamma']));
    expect(visible.map(l => l.dataKey)).toEqual(['a', 'c']);
  });

  it('drops series beyond HARD_LINES_LIMIT', () => {
    const lineData = Array.from({ length: HARD_LINES_LIMIT + 5 }, (_, i) =>
      makeLine(`series-${i}`),
    );
    const visible = getVisibleLineData(lineData, undefined);
    expect(visible).toHaveLength(HARD_LINES_LIMIT);
    // A series past the limit must never appear, even if selected.
    const overLimitName = `series-${HARD_LINES_LIMIT + 2}`;
    expect(getVisibleLineData(lineData, new Set([overLimitName]))).toHaveLength(
      0,
    );
  });
});

// The drill-down popover payload is rebuilt from the clicked bucket row. This
// pins that it only includes visible series with a numeric value, and carries
// the fields the popover renders (name/color/dataKey/value).
describe('buildActiveClickSeries', () => {
  const makeLine = (dataKey: string, displayName?: string): LineData => ({
    dataKey,
    currentPeriodKey: dataKey,
    previousPeriodKey: `${dataKey}.prev`,
    displayName: displayName ?? dataKey,
    valueColumnName: dataKey,
    color: `#${dataKey}`,
  });

  it('returns [] when there is no active row', () => {
    expect(buildActiveClickSeries([makeLine('a')], undefined)).toEqual([]);
  });

  it('includes only visible series with a numeric value at the bucket', () => {
    const visible = [makeLine('a', 'Alpha'), makeLine('b', 'Beta')];
    // `b` is missing/non-numeric at this bucket, so it is excluded.
    const row = { ts_bucket: 1000, a: 42, b: null };
    expect(buildActiveClickSeries(visible, row)).toEqual([
      {
        dataKey: 'a',
        name: 'Alpha',
        value: 42,
        color: '#a',
        valueColumnName: 'a',
        isPreviousPeriod: false,
        previousValue: undefined,
      },
    ]);
  });

  it('preserves zero values but drops non-numeric ones', () => {
    const visible = [makeLine('a'), makeLine('b')];
    const row = { a: 0, b: 'oops' };
    const result = buildActiveClickSeries(visible, row);
    expect(result.map(r => r.dataKey)).toEqual(['a']);
    expect(result[0].value).toBe(0);
  });

  it('pairs a current-period series with its previous-period value', () => {
    // makeLine sets previousPeriodKey to `${dataKey}.prev`; when the bucket row
    // carries a numeric value under that key, it is surfaced as previousValue
    // so the pinned tooltip can render the percent-change chip.
    const visible = [makeLine('a', 'Alpha')];
    const row = { a: 100, 'a.prev': 80 };
    const result = buildActiveClickSeries(visible, row);
    expect(result[0]).toMatchObject({
      dataKey: 'a',
      value: 100,
      previousValue: 80,
      isPreviousPeriod: false,
    });
  });

  it('leaves previousValue undefined when the previous bucket is non-numeric', () => {
    const visible = [makeLine('a')];
    const row = { a: 100, 'a.prev': null };
    const result = buildActiveClickSeries(visible, row);
    expect(result[0].previousValue).toBeUndefined();
  });

  it('marks a previous-period line (previousPeriodKey === dataKey) and gives it no comparison', () => {
    // A dashed previous-period line's dataKey equals its previousPeriodKey.
    // It must be flagged isPreviousPeriod (so the tooltip can fold it away)
    // and never pair itself as its own comparison.
    const prevLine: LineData = {
      dataKey: 'a.prev',
      currentPeriodKey: 'a',
      previousPeriodKey: 'a.prev',
      displayName: 'Alpha (previous)',
      valueColumnName: 'a',
      color: '#a',
      isDashed: true,
    };
    const row = { 'a.prev': 80 };
    const result = buildActiveClickSeries([prevLine], row);
    expect(result[0]).toMatchObject({
      dataKey: 'a.prev',
      isPreviousPeriod: true,
      previousValue: undefined,
    });
  });
});

// The hover tooltip shows a different set of rows depending on its mode and
// whether the cursor is over this chart or a synced follower. These pin that
// selection so a dense chart never regresses to a wall of rows, and a follower
// never surfaces a series the user is not actually hovering.
describe('selectTooltipRows', () => {
  const row = (dataKey: string, value: number, name?: string) => ({
    dataKey,
    name: name ?? dataKey,
    value,
  });

  describe('all-series mode', () => {
    it('returns every row sorted high to low by value', () => {
      const payload = [row('a', 10), row('b', 30), row('c', 20)];
      const rows = selectTooltipRows({
        payload,
        nearestOnly: false,
        isChartHovered: true,
      });
      expect(rows?.map(r => r.dataKey)).toEqual(['b', 'c', 'a']);
    });

    it('sorts a copy and never reorders the payload in place', () => {
      // Recharts 3 freezes the payload; an in-place sort throws. The order of
      // the caller's array must be untouched after the call.
      const payload = [row('a', 10), row('b', 30), row('c', 20)];
      const before = payload.map(r => r.dataKey);
      selectTooltipRows({ payload, nearestOnly: false, isChartHovered: true });
      expect(payload.map(r => r.dataKey)).toEqual(before);
    });

    it('ignores hover flags: all rows show even off the hovered chart', () => {
      const payload = [row('a', 10), row('b', 30)];
      const rows = selectTooltipRows({
        payload,
        nearestOnly: false,
        isChartHovered: false,
        crossChartHoveredName: 'no-such-series',
      });
      expect(rows?.map(r => r.dataKey)).toEqual(['b', 'a']);
    });
  });

  describe('single-series mode on the hovered chart', () => {
    it('returns only the series matching nearestKey', () => {
      const payload = [row('a', 10), row('b', 30), row('c', 20)];
      const rows = selectTooltipRows({
        payload,
        nearestOnly: true,
        isChartHovered: true,
        nearestKey: 'a',
      });
      expect(rows).toHaveLength(1);
      expect(rows?.[0].dataKey).toBe('a');
    });

    it('falls back to the top series by value when nearestKey is undefined', () => {
      const payload = [row('a', 10), row('b', 30), row('c', 20)];
      const rows = selectTooltipRows({
        payload,
        nearestOnly: true,
        isChartHovered: true,
      });
      expect(rows?.map(r => r.dataKey)).toEqual(['b']);
    });

    it('falls back to the top series by value when nearestKey is absent from the payload', () => {
      const payload = [row('a', 10), row('b', 30)];
      const rows = selectTooltipRows({
        payload,
        nearestOnly: true,
        isChartHovered: true,
        nearestKey: 'ghost',
      });
      expect(rows?.map(r => r.dataKey)).toEqual(['b']);
    });
  });

  describe('single-series mode on a synced follower', () => {
    it('returns the series whose display name matches the one hovered elsewhere', () => {
      const payload = [row('a', 10, 'Alpha'), row('b', 30, 'Beta')];
      const rows = selectTooltipRows({
        payload,
        nearestOnly: true,
        isChartHovered: false,
        crossChartHoveredName: 'Alpha',
      });
      expect(rows?.map(r => r.dataKey)).toEqual(['a']);
    });

    it('returns null (render nothing) when no series matches the hovered name', () => {
      const payload = [row('a', 10, 'Alpha'), row('b', 30, 'Beta')];
      const rows = selectTooltipRows({
        payload,
        nearestOnly: true,
        isChartHovered: false,
        crossChartHoveredName: 'Gamma',
      });
      expect(rows).toBeNull();
    });

    it('returns null when there is no hovered series to match', () => {
      const payload = [row('a', 10, 'Alpha')];
      const rows = selectTooltipRows({
        payload,
        nearestOnly: true,
        isChartHovered: false,
      });
      expect(rows).toBeNull();
    });
  });
});
