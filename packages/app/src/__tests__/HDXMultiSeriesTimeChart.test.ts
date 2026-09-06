// Targeted unit test for the `<linearGradient>` defs union that backs
// `<Area url(#time-chart-lin-grad-…)>` lookups inside `MemoChart`. The
// helper is exported so we can pin the union/dedup behavior without
// rendering recharts in jsdom (which struggles with sized SVG
// containers). Covers the regression flagged in the deep review on
// #2362 where a semantic-hex `lineData[].color` (e.g. the output of
// `getChartColorInfo()` on HyperDX) would not have a matching gradient
// def after the `COLORS` palette was unified to Observable 10.
import type { LineData } from '@/ChartUtils';
import type { ActiveClickSeries } from '@/HDXMultiSeriesTimeChart';
import {
  buildActiveClickSeries,
  collectMemoChartGradientHexes,
  formatAxisTick,
  getSelectedLineData,
  getVisibleLineData,
  getVisibleTooltipRows,
  HARD_LINES_LIMIT,
  sameActiveClickSeries,
} from '@/HDXMultiSeriesTimeChart';
import { COLORS } from '@/utils';

describe('formatAxisTick', () => {
  it('falls back to mantissa 0 when the format has none configured', () => {
    // Matches the historical behavior for typically-large, unconfigured
    // counts (log/event counts, request rates): compact, no decimals.
    expect(formatAxisTick(1234, { output: 'number' })).toBe('1k');
  });

  it('honors an explicit mantissa instead of always rounding to 0', () => {
    // Regression: a chart whose Decimals setting produces correct
    // tooltip/legend values (e.g. via formatNumber(value, numberFormat)
    // directly, see ChartTooltip.tsx) would previously still show every
    // axis tick as "0" for values under 1 (fractional Prometheus gauges,
    // ratios, etc.), since mantissa was unconditionally forced to 0.
    expect(formatAxisTick(0.14, { output: 'number', mantissa: 2 })).toBe(
      '0.14',
    );
    expect(formatAxisTick(0.021, { output: 'number', mantissa: 2 })).toBe(
      '0.02',
    );
  });

  it('caps a sub-1 tick`s mantissa at 2 instead of honoring it outright', () => {
    // The Decimals setting allows up to 10, which would badly overflow the
    // axis's label budget for a sub-1 tick (measured: "0.1400000000" is far
    // wider than "0.14" fits) if honored outright.
    expect(formatAxisTick(0.14, { output: 'number', mantissa: 10 })).toBe(
      '0.14',
    );
  });

  it('forces 0 decimals for any tick >= 10, regardless of configured mantissa', () => {
    // Regression (caught in review): HyperDX's own bundled dashboard
    // templates (e.g. go-runtime.json) set mantissa on tiles whose values
    // are well above the threshold, for tooltip readability, unrelated to
    // the near-zero problem this formatter fixes - honoring it there
    // instead of forcing 0 would turn shipped ticks like `200`/`1k` into
    // `200.00`/`1.23k`, wide enough to overflow the axis's label budget for
    // an ordinary value, not just an extreme one.
    expect(formatAxisTick(200, { output: 'number', mantissa: 2 })).toBe('200');
    expect(formatAxisTick(1234, { output: 'number', mantissa: 10 })).toBe('1k');
    expect(formatAxisTick(10, { output: 'number', mantissa: 2 })).toBe('10');
    // A negative tick is still `>= 10` in magnitude (Math.abs), so it's
    // integer too.
    expect(formatAxisTick(-15, { output: 'number', mantissa: 2 })).toBe('-15');
  });

  it('honors configured mantissa up to 9.99 in magnitude, positive or negative', () => {
    // Raised from a >= 1 threshold to >= 10: at a 2-decimal cap, a single
    // extra character - a negative sign or a percent suffix - still fits
    // the axis's label budget up to one integer digit (measured: "-9.99"
    // and "9.99%" are both the same width as "99.99", which fits). This
    // also mostly avoids the mixed-precision-on-one-axis problem a >= 1
    // threshold had: ticks 0, 0.5, 1, 1.5, 2 on one chart no longer collapse
    // 1.5 and 2 into the identical label "2".
    expect(formatAxisTick(9.99, { output: 'number', mantissa: 2 })).toBe(
      '9.99',
    );
    expect(formatAxisTick(-1.5, { output: 'number', mantissa: 2 })).toBe(
      '-1.50',
    );
  });

  it('always renders exactly 0 as a bare integer', () => {
    // Regression (caught in review): 0 has magnitude 0, which is under any
    // positive threshold, so it took the capped-mantissa branch and
    // rendered `0.00`/`0.0 B` - on essentially every chart, since the
    // y-axis domain defaults to starting at 0. 0 is already unambiguous;
    // it doesn't need the decimal rescue this formatter exists to provide.
    expect(formatAxisTick(0, { output: 'number', mantissa: 2 })).toBe('0');
    expect(formatAxisTick(0, { output: 'byte', mantissa: 1 })).toBe('0 B');
  });

  it('checks a percent tick`s magnitude against its displayed (x100) value', () => {
    // Regression (caught in review): formatNumber multiplies a percent
    // value by 100 before applying mantissa, since a percent tile's raw
    // value is a 0-1 ratio. Checking the raw value's magnitude instead of
    // the displayed one meant every percent tick took the capped-mantissa
    // branch regardless of the rendered percentage - go-runtime.json's
    // process.cpu.utilization tile (`{output: 'percent', mantissa: 1}`)
    // would go from `25%` to `25.00%` for an ordinary, not-near-zero value.
    expect(formatAxisTick(0.25, { output: 'percent', mantissa: 2 })).toBe(
      '25%',
    );
    // A genuinely near-zero percent (0.1%) still gets the decimal rescue.
    expect(formatAxisTick(0.001, { output: 'percent', mantissa: 2 })).toBe(
      '0.10%',
    );
  });

  it('preserves shipped byte/throughput tiles that configure a mantissa', () => {
    // go-runtime.json's "Memory: Used vs Limit vs GC Target" tile ships as
    // { output: 'byte', mantissa: 1 } - a raw byte count is always >= 1, so
    // this hits the forced-integer branch and stays `256 MB`, not `256.0 MB`.
    expect(formatAxisTick(268435456, { output: 'byte', mantissa: 1 })).toBe(
      '256 MB',
    );
    expect(formatAxisTick(1234567, { output: 'throughput', mantissa: 2 })).toBe(
      '1234567',
    );
  });

  it('always strips a configured unit and forces compact averaging', () => {
    expect(
      formatAxisTick(1234, {
        output: 'number',
        mantissa: 2,
        unit: 'req/s',
      }),
    ).toBe('1k');
  });

  it('uses compact Intl formatting when no axisNumberFormat is set', () => {
    expect(formatAxisTick(1234)).toBe('1.2K');
  });
});

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

  it('caps to HARD_LINES_LIMIT when there is no selection', () => {
    const lineData = Array.from({ length: HARD_LINES_LIMIT + 5 }, (_, i) =>
      makeLine(`series-${i}`),
    );
    const visible = getVisibleLineData(lineData, undefined);
    expect(visible).toHaveLength(HARD_LINES_LIMIT);
    expect(visible.map(l => l.dataKey)).not.toContain(
      `series-${HARD_LINES_LIMIT + 2}`,
    );
  });

  it('draws a selected series even when it ranks beyond HARD_LINES_LIMIT', () => {
    const lineData = Array.from({ length: HARD_LINES_LIMIT + 5 }, (_, i) =>
      makeLine(`series-${i}`),
    );
    // Selection wins over the cap: isolating a low-ranked series still draws it
    // (cap-first order previously left the chart empty while its stats stayed
    // in the legend table).
    const overLimitName = `series-${HARD_LINES_LIMIT + 2}`;
    expect(
      getVisibleLineData(lineData, new Set([overLimitName])).map(
        l => l.dataKey,
      ),
    ).toEqual([overLimitName]);
  });

  it('still caps an oversized manual selection to HARD_LINES_LIMIT', () => {
    const lineData = Array.from({ length: HARD_LINES_LIMIT + 20 }, (_, i) =>
      makeLine(`series-${i}`),
    );
    const everySeries = new Set(lineData.map(l => l.dataKey));
    expect(getVisibleLineData(lineData, everySeries)).toHaveLength(
      HARD_LINES_LIMIT,
    );
  });
});

describe('getSelectedLineData', () => {
  const makeLine = (dataKey: string, displayName?: string): LineData => ({
    dataKey,
    currentPeriodKey: dataKey,
    previousPeriodKey: `${dataKey}.prev`,
    displayName: displayName ?? dataKey,
    valueColumnName: dataKey,
    color: '#abcdef',
  });

  it('does NOT cap to HARD_LINES_LIMIT (feeds the uncapped pinned tooltip list)', () => {
    // The pinned tooltip's drill-down list may show more series than are drawn,
    // so selection is applied without the draw cap. This is the behavior that
    // lets "load all series" reveal materialized-but-undrawn series.
    const lineData = Array.from({ length: HARD_LINES_LIMIT + 50 }, (_, i) =>
      makeLine(`series-${i}`),
    );
    expect(getSelectedLineData(lineData, undefined)).toHaveLength(
      HARD_LINES_LIMIT + 50,
    );
  });

  it('applies the same name-based selection as getVisibleLineData', () => {
    const lineData = [
      makeLine('a', 'Alpha'),
      makeLine('b', 'Beta'),
      makeLine('c', 'Gamma'),
    ];
    expect(
      getSelectedLineData(lineData, new Set(['Alpha', 'Gamma'])).map(
        l => l.dataKey,
      ),
    ).toEqual(['a', 'c']);
  });

  it('returns every series when the selection is empty', () => {
    const lineData = [makeLine('a'), makeLine('b')];
    expect(
      getSelectedLineData(lineData, new Set()).map(l => l.dataKey),
    ).toEqual(['a', 'b']);
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

  it('drops non-finite values (NaN/Infinity) so the resync guard stays stable', () => {
    // A ratio chart's zero-denominator bucket yields NaN; admitting it would
    // break the NaN-unsafe equality guard and loop the resync effect.
    const visible = [makeLine('a'), makeLine('b'), makeLine('c')];
    const row = { a: NaN, b: Infinity, c: 7 };
    const result = buildActiveClickSeries(visible, row);
    expect(result.map(r => r.dataKey)).toEqual(['c']);
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

describe('sameActiveClickSeries', () => {
  const row = (
    dataKey: string,
    value: number,
    previousValue?: number,
  ): ActiveClickSeries => ({ dataKey, value, previousValue });

  it('treats an undefined prior snapshot as changed (initial fill)', () => {
    expect(sameActiveClickSeries(undefined, [row('a', 1)])).toBe(false);
  });

  it('detects added series (the "load all" case)', () => {
    // A capped snapshot gains series once the render cap is lifted; the pinned
    // tooltip must rebuild so its "+N more" overflow reflects the drawn set.
    const before = [row('a', 5)];
    const after = [row('a', 5), row('b', 3)];
    expect(sameActiveClickSeries(before, after)).toBe(false);
  });

  it('detects a changed value at the pinned bucket', () => {
    expect(sameActiveClickSeries([row('a', 5)], [row('a', 6)])).toBe(false);
  });

  it('detects a changed previous-period comparison value', () => {
    expect(sameActiveClickSeries([row('a', 5, 4)], [row('a', 5, 9)])).toBe(
      false,
    );
  });

  it('is stable for an identical drawn set (no churn on ordinary re-renders)', () => {
    const before = [row('a', 5), row('b', 3)];
    const after = [row('a', 5), row('b', 3)];
    expect(sameActiveClickSeries(before, after)).toBe(true);
  });

  it('treats NaN-holding snapshots as equal (no infinite resync loop)', () => {
    // Regression: `NaN !== NaN` would report identical NaN-holding snapshots as
    // perpetually changed, driving the resync effect into an infinite loop.
    // Object.is makes NaN compare equal to itself. (In practice
    // buildActiveClickSeries now also drops non-finite values, but the equality
    // must be NaN-safe regardless.)
    const before = [row('a', NaN)];
    const after = [row('a', NaN)];
    expect(sameActiveClickSeries(before, after)).toBe(true);

    const beforePrev = [row('a', 5, NaN)];
    const afterPrev = [row('a', 5, NaN)];
    expect(sameActiveClickSeries(beforePrev, afterPrev)).toBe(true);
  });
});

describe('getVisibleTooltipRows', () => {
  const mkRows = (n: number) =>
    Array.from({ length: n }, (_, i) => ({ dataKey: `s${i}` }));

  it('returns all rows and zero hidden when within the limit', () => {
    const rows = mkRows(5);
    const result = getVisibleTooltipRows(rows, undefined, 20);
    expect(result.rows).toBe(rows); // same reference, no copy
    expect(result.hiddenCount).toBe(0);
  });

  it('caps to the limit and reports the remainder as hidden', () => {
    const rows = mkRows(100);
    const result = getVisibleTooltipRows(rows, undefined, 20);
    expect(result.rows).toHaveLength(20);
    expect(result.hiddenCount).toBe(80);
    // Keeps the highest-ranked (value-desc caller ordering) head.
    expect(result.rows[0].dataKey).toBe('s0');
    expect(result.rows[19].dataKey).toBe('s19');
  });

  it('keeps the cursor-nearest series even when it ranks past the cap', () => {
    const rows = mkRows(100);
    const result = getVisibleTooltipRows(rows, 's50', 20);
    expect(result.rows).toHaveLength(20);
    expect(result.hiddenCount).toBe(80);
    const keys = result.rows.map(r => r.dataKey);
    expect(keys).toContain('s50');
    // The lowest kept row was swapped out to make room; count stays stable.
    expect(keys).not.toContain('s19');
  });

  it('does not duplicate the nearest series when it is already visible', () => {
    const rows = mkRows(100);
    const result = getVisibleTooltipRows(rows, 's3', 20);
    const keys = result.rows.map(r => r.dataKey);
    expect(keys.filter(k => k === 's3')).toHaveLength(1);
    expect(result.rows).toHaveLength(20);
  });
});
