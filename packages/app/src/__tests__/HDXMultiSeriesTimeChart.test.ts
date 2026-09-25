// Targeted unit test for the `<linearGradient>` defs union that backs
// `<Area url(#time-chart-lin-grad-…)>` lookups inside `MemoChart`. The
// helper is exported so we can pin the union/dedup behavior without
// rendering recharts in jsdom (which struggles with sized SVG
// containers). Covers the regression flagged in the deep review on
// #2362 where a semantic-hex `lineData[].color` (e.g. the output of
// `getChartColorInfo()` on HyperDX) would not have a matching gradient
// def after the `COLORS` palette was unified to Observable 10.
import { DisplayType, NumericUnit } from '@hyperdx/common-utils/dist/types';

import type { LineData } from '@/ChartUtils';
import type { ActiveClickSeries } from '@/HDXMultiSeriesTimeChart';
import {
  buildActiveClickSeries,
  collectMemoChartGradientHexes,
  computeYAxisBounds,
  formatAxisTick,
  getExpandableYAxisTicks,
  getNiceYAxisTicks,
  getSelectedLineData,
  getVisibleLineData,
  getVisibleTooltipRows,
  getYAxisTicks,
  HARD_LINES_LIMIT,
  sameActiveClickSeries,
  scanYAxisValueRange,
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

  it('caps mantissa at 2 instead of honoring the Decimals setting outright', () => {
    // The Decimals setting allows up to 10, which would badly overflow the
    // axis's label budget (measured: "0.1400000000" is far wider than
    // "0.14") if honored outright.
    expect(formatAxisTick(0.14, { output: 'number', mantissa: 10 })).toBe(
      '0.14',
    );
  });

  it('searches downward for the most precision that still fits the axis budget', () => {
    // Regression: a large tick used to force 0 decimals even though the
    // abbreviated (k/m/b/t) form had room for precision ("1.08k" fits "1k"'s budget).
    expect(formatAxisTick(200, { output: 'number', mantissa: 2 })).toBe('200');
    expect(formatAxisTick(1234, { output: 'number', mantissa: 10 })).toBe(
      '1.23k',
    );
    expect(formatAxisTick(10, { output: 'number', mantissa: 2 })).toBe('10');
    expect(formatAxisTick(-15, { output: 'number', mantissa: 2 })).toBe('-15');
    // Backs off a decimal at a time when full precision would overflow
    // the budget (e.g. "12.34k" is 6 chars), rather than jumping to 0.
    expect(formatAxisTick(12340, { output: 'number', mantissa: 2 })).toBe(
      '12.3k',
    );
    // Trims only the insignificant trailing zero, keeping the "5".
    expect(formatAxisTick(1500, { output: 'number', mantissa: 2 })).toBe(
      '1.5k',
    );
    // A single extra character - a negative sign or a percent suffix -
    // still fits at 2 decimals up to one integer digit.
    expect(formatAxisTick(9.99, { output: 'number', mantissa: 2 })).toBe(
      '9.99',
    );
    expect(formatAxisTick(-1.5, { output: 'number', mantissa: 2 })).toBe(
      '-1.5',
    );
  });

  it('always renders exactly 0 as a bare integer', () => {
    // 0 needs no decimal rescue - it's already unambiguous - and the search
    // naturally produces this by trimming "0.00"/"0.0 B" down to "0"/"0 B".
    expect(formatAxisTick(0, { output: 'number', mantissa: 2 })).toBe('0');
    expect(formatAxisTick(0, { output: 'byte', mantissa: 1 })).toBe('0 B');
  });

  it('applies mantissa to a percent tick`s displayed (x100) value', () => {
    // formatNumber multiplies a percent value by 100 before applying
    // mantissa, since a percent tile's raw value is a 0-1 ratio.
    expect(formatAxisTick(0.25, { output: 'percent', mantissa: 2 })).toBe(
      '25%',
    );
    expect(formatAxisTick(0.001, { output: 'percent', mantissa: 2 })).toBe(
      '0.1%',
    );
  });

  it('preserves shipped byte/throughput tiles that configure a mantissa', () => {
    // go-runtime.json's "Memory: Used vs Limit vs GC Target" tile ships as
    // { output: 'byte', mantissa: 1 }.
    expect(formatAxisTick(268435456, { output: 'byte', mantissa: 1 })).toBe(
      '256 MB',
    );
    expect(formatAxisTick(1234567, { output: 'throughput', mantissa: 2 })).toBe(
      '1234567',
    );
  });

  it('distinguishes nearby byte values instead of collapsing them like the pre-fix number axis did', () => {
    // Regression: the budget was measured against the whole string
    // including byte's " GB" suffix, so any decimal was always too wide.
    const GB = 1024 ** 3;
    expect(formatAxisTick(1.2 * GB, { output: 'byte', mantissa: 1 })).toBe(
      '1.2 GB',
    );
    expect(formatAxisTick(1.4 * GB, { output: 'byte', mantissa: 1 })).toBe(
      '1.4 GB',
    );
  });

  it('backs off to an integer for a numericUnit suffix too wide to fit a decimal', () => {
    // "GiB" leaves no room under axisLabelBudget for a decimal - collapsing
    // both to "1 GiB" is the safe outcome, not the byte-suffix bug this fixes.
    const GB = 1024 ** 3;
    const config = {
      output: 'byte' as const,
      numericUnit: NumericUnit.BytesIEC,
      mantissa: 1,
    };
    expect(formatAxisTick(1.2 * GB, config)).toBe('1 GiB');
    expect(formatAxisTick(1.4 * GB, config)).toBe('1 GiB');
  });

  it('falls back toward fewer decimals for a long unit suffix instead of overflowing', () => {
    // Regression: exempting the unit suffix from the budget outright made
    // "1.25 Gibit/s" (12 chars) pass just because "1.25" alone fit.
    const GIBIT = 1024 ** 3;
    expect(
      formatAxisTick(1.25 * GIBIT, {
        output: 'data_rate',
        numericUnit: NumericUnit.BitsSecIEC,
        mantissa: 2,
      }),
    ).toBe('1 Gibit/s');
  });

  it('does not clip a shipped byte tile by over-budgeting the unit suffix', () => {
    // Regression: a flat +5 suffix allowance let "281.6 MB" (8 chars)
    // pass, clipping the 40px axis on a shipped go-runtime.json tile.
    expect(formatAxisTick(295_279_001, { output: 'byte', mantissa: 1 })).toBe(
      '282 MB',
    );
  });

  it('drops a fixed unit suffix from the axis to spend the budget on precision', () => {
    // "cps"/"Gibit/s" is identical on every tick of a fixed-unit axis, so it
    // carries no information there - unlike an auto-scale suffix (KiB/MiB/...).
    expect(
      formatAxisTick(0.25, {
        output: 'throughput',
        numericUnit: NumericUnit.Cps,
        mantissa: 2,
      }),
    ).toBe('0.25');
    expect(
      formatAxisTick(0.25, {
        output: 'data_rate',
        numericUnit: NumericUnit.GibibitsSec,
        mantissa: 2,
      }),
    ).toBe('0.25');
    // A byte tile pinned to a fixed unit (rather than auto-scaling) too.
    expect(
      formatAxisTick(512.5, {
        output: 'byte',
        numericUnit: NumericUnit.Kibibytes,
        mantissa: 1,
      }),
    ).toBe('512.5');
  });

  it('keeps a small negative percentage distinguishable from 0', () => {
    // Regression: budget 5 rejected "-0.01%" (6 chars, sign+suffix
    // together), falling to 1 decimal, which trimmed "-0.0%" to "-0%".
    expect(formatAxisTick(-0.0001, { output: 'percent', mantissa: 2 })).toBe(
      '-0.01%',
    );
  });

  it('drops the sign from a negative tick that rounds to zero', () => {
    // Regression: throughput's raw toFixed (not numbro) yields "-0.00",
    // trimming to a bare "-0" instead of an unambiguous "0".
    expect(formatAxisTick(-0.001, { output: 'throughput', mantissa: 2 })).toBe(
      '0',
    );
  });

  it('always strips a configured unit and forces compact averaging', () => {
    expect(
      formatAxisTick(1234, {
        output: 'number',
        mantissa: 2,
        unit: 'req/s',
      }),
    ).toBe('1.23k');
  });

  it('uses compact Intl formatting when no axisNumberFormat is set', () => {
    expect(formatAxisTick(1234)).toBe('1.2K');
  });

  describe('duration output', () => {
    // Regression: 'duration' bypasses this formatter's width safety entirely
    // (formatNumber returns early for it), and formatDurationMs has no width
    // budget of its own - e.g. "13.33min" is 8 characters.
    it('renders minutes with a single-character unit, not "min"', () => {
      expect(formatAxisTick(799.8, { output: 'duration' })).toBe('13m');
    });

    it('renders seconds compactly', () => {
      expect(formatAxisTick(39.51, { output: 'duration' })).toBe('39.5s');
    });

    it('respects a configured factor, matching formatNumber`s own duration math', () => {
      expect(
        formatAxisTick(442_800, { output: 'duration', factor: 0.001 }),
      ).toBe('7.4m');
    });

    it('renders sub-millisecond and hour-scale values compactly too', () => {
      expect(formatAxisTick(0.0000005, { output: 'duration' })).toBe('500ns');
      expect(formatAxisTick(7500, { output: 'duration' })).toBe('2.1h');
    });
  });
});

describe('getNiceYAxisTicks', () => {
  it('rounds to a clean step instead of dividing the raw range', () => {
    // Regression: evenly dividing an unrounded range into quarters gave
    // fractional labels (341/683/1k) or, worse, duplicate rounded ones.
    expect(getNiceYAxisTicks(0, 1000).ticks).toEqual([0, 250, 500, 750, 1000]);
  });

  it('works for a non-zero lower bound', () => {
    expect(getNiceYAxisTicks(10, 30).ticks).toEqual([10, 15, 20, 25, 30]);
  });

  it('never expands past the given range, even if it clips ticks short', () => {
    // A tight/fitted range shouldn't gain extra ticks beyond its own bounds.
    expect(getNiceYAxisTicks(95, 205).ticks).toEqual([100, 125, 150, 175, 200]);
  });

  it('returns no ticks for a degenerate (flat) range', () => {
    expect(getNiceYAxisTicks(5, 5).ticks).toEqual([]);
  });

  it('cleans up float dust from a fractional step', () => {
    // Regression: without rounding, a 0.1 step gave 0.30000000000000004.
    expect(getNiceYAxisTicks(0, 0.42).ticks).toEqual([0, 0.1, 0.2, 0.3, 0.4]);
  });

  it('never returns more than maxTicks ticks', () => {
    // Regression: rounding to the nearest step could pick one below the
    // raw target, overflowing to 6 ticks here instead of capping at 5.
    expect(getNiceYAxisTicks(0, 1480).ticks.length).toBeLessThanOrEqual(5);
  });

  it('rejects a step whose only distinct formatting overflows the label budget', () => {
    // This domain needs 17-char labels to distinguish at all - no step
    // fits the budget and stays distinct, so this returns no ticks.
    expect(getNiceYAxisTicks(999999999999, 1000000000030).ticks).toEqual([]);
  });

  it('avoids a step that formatAxisTick would round unevenly (12.5 -> "13")', () => {
    // At this magnitude (exp === 0), a 2.5 step yields non-integer ticks
    // that straddle formatAxisTick's forced-integer threshold of 10.
    expect(getNiceYAxisTicks(0, 12.6).ticks).toEqual([0, 5, 10]);
  });

  it('never accepts a single tick, even though it is trivially "distinct"', () => {
    // Regression: a lone survivor's label can't collide with anything,
    // so a naive distinctness check accepted a one-tick, no-scale axis.
    const result = getNiceYAxisTicks(999999999999, 1000000000000.001);
    expect(result.ticks.length === 0 || result.ticks.length >= 2).toBe(true);
  });

  it('escalates precision past the configured mantissa to keep labels distinct', () => {
    // Regression: two ticks must never show the same label - 0 decimals
    // collapses a narrow byte range entirely to "3 GB".
    const GB = 1024 ** 3;
    const result = getNiceYAxisTicks(2.825 * GB, 3.45 * GB, 5, {
      output: 'byte',
      mantissa: 0,
    });
    const labels = result.ticks.map(t => result.tickFormatter!(t));
    expect(result.ticks.length).toBeGreaterThanOrEqual(2);
    expect(new Set(labels).size).toBe(labels.length);
  });

  it('falls back to full, non-compact precision when no format is configured', () => {
    // Regression: with no mantissa to escalate, close-together magnitudes
    // collapsed under Intl's compact notation (e.g. "1T") instead.
    const result = getNiceYAxisTicks(999999999999, 1000000000030);
    const labels = result.ticks.map(t => result.tickFormatter!(t));
    expect(new Set(labels).size).toBe(labels.length);
  });

  it('escalates from the minimal precision, not past what distinctness needs', () => {
    // Regression: starting escalation above 1 (e.g. at "configured+1")
    // skipped a sufficient mantissa, producing needlessly wide labels.
    const result = getExpandableYAxisTicks(0, 2100, 5, { output: 'number' });
    expect(result.ticks.map(t => result.tickFormatter!(t))).toEqual([
      '0',
      '0.5k',
      '1k',
      '1.5k',
      '2k',
    ]);
  });

  it('escalates a duration format past its fixed significant-digit count', () => {
    // Regression: duration collisions returned null unconditionally,
    // discarding the tick list instead of trying more precision.
    const result = getNiceYAxisTicks(3600, 3700, 5, { output: 'duration' });
    expect(result.tickFormatter).toBeDefined();
    const labels = result.ticks.map(t => result.tickFormatter!(t));
    expect(new Set(labels).size).toBe(labels.length);
  });

  it('rejects a plain-number escalation that would overflow the axis label budget', () => {
    // Regression: mantissa 3 was needed for distinctness but rendered
    // "1.0500k" (7 chars) - must be rejected in favor of a coarser step.
    const result = getExpandableYAxisTicks(1050, 1050.315, 5, {
      output: 'number',
      mantissa: 3,
    });
    const labels = result.ticks.map(t => result.tickFormatter!(t));
    expect(labels.every(l => l.length <= 5)).toBe(true);
  });

  it('escalates a fixed-unit axis without reintroducing the suffix it drops', () => {
    // Regression: escalation called formatNumber directly, restoring the
    // "cps" suffix formatAxisTick strips - overflowing the label budget.
    const result = getExpandableYAxisTicks(1.15, 1.150115, 5, {
      output: 'throughput',
      numericUnit: NumericUnit.Cps,
      mantissa: 2,
    });
    expect(result.ticks.map(t => result.tickFormatter!(t))).toEqual([
      '1.1',
      '1.2',
    ]);
  });

  it('rejects a full-precision fallback that overflows the label budget', () => {
    // Regression: no-format fallback had no budget check, rendering
    // 9-char grouped numbers instead of falling through to a coarser step.
    const result = getNiceYAxisTicks(1200000, 1250000);
    const labels = result.ticks.map(t => result.tickFormatter!(t));
    expect(labels.every(l => l.length <= 5)).toBe(true);
    expect(new Set(labels).size).toBe(labels.length);
  });

  it('excludes a 2.5-scaled step below 1 only when the format forces integers', () => {
    // Regression: step 0.25 (2.5x10^-1) survived the bare-2.5 filter,
    // rounding to an uneven 0.3/0.2/0.3/0.2 progression at mantissa 0.
    const forcedInteger = getNiceYAxisTicks(0, 1.1, 5, {
      output: 'number',
      mantissa: 0,
    });
    expect(forcedInteger.ticks).toEqual([0, 0.5, 1]);

    // With decimals to spend, 0.25 renders exactly - keep the denser step.
    const withDecimals = getNiceYAxisTicks(0, 1.1, 5, {
      output: 'number',
      mantissa: 2,
    });
    expect(withDecimals.ticks).toEqual([0, 0.25, 0.5, 0.75, 1]);
  });
});

describe('scanYAxisValueRange', () => {
  const series = (dataKey: string): LineData => ({
    dataKey,
    currentPeriodKey: dataKey,
    previousPeriodKey: `${dataKey}.prev`,
    displayName: dataKey,
    valueColumnName: dataKey,
    color: '#a',
  });

  it('finds the min/max across every series it is given', () => {
    // Callers pass only the drawn series (already selection- and
    // HARD_LINES_LIMIT-filtered), so no visibility filtering happens here.
    const lineData = [series('a'), series('b')];
    const graphResults = [{ a: 10, b: 40 }, { a: -5 }];
    expect(scanYAxisValueRange(graphResults, lineData)).toEqual({
      min: -5,
      max: 40,
    });
  });
});

describe('computeYAxisBounds', () => {
  const series = (dataKey: string): LineData => ({
    dataKey,
    currentPeriodKey: dataKey,
    previousPeriodKey: `${dataKey}.prev`,
    displayName: dataKey,
    valueColumnName: dataKey,
    color: '#a',
  });

  it('rounds ticks to clean, non-duplicating values', () => {
    // A peak of 3 divided into raw quarters rounds (mantissa 0) to
    // 0/1/2/2/3 - two ticks reading "2" at different heights.
    const bounds = computeYAxisBounds(
      [{ a: 3 }],
      [series('a')],
      false,
      false,
      DisplayType.Line,
      [],
    );
    expect(bounds).toEqual({
      domain: [0, 3.15],
      ticks: [0, 1, 2, 3],
      tickFormatter: expect.any(Function),
    });
  });

  it('never picks a step that formatAxisTick would round unevenly', () => {
    // Regression: a 2.5 step at this magnitude gives "12.5", which
    // formatAxisTick rounds to "13" - an uneven-looking progression.
    const bounds = computeYAxisBounds(
      [{ a: 12 }],
      [series('a')],
      false,
      false,
      DisplayType.Line,
      [],
    );
    expect(bounds).toEqual({
      domain: [0, 15],
      ticks: [0, 5, 10, 15],
      tickFormatter: expect.any(Function),
    });
  });

  it('expands past padding to avoid a sparse, dead-space-heavy axis', () => {
    // Regression: a step landing between two step levels left only 3
    // ticks (0/500/1000) over domain [0,1260], 20% dead space at the top.
    const bounds = computeYAxisBounds(
      [{ a: 1200 }],
      [series('a')],
      false,
      false,
      DisplayType.Line,
      [],
    );
    expect(bounds).toEqual({
      domain: [0, 1500],
      ticks: [0, 500, 1000, 1500],
      tickFormatter: expect.any(Function),
    });
  });

  it('extends the zero-pinned domain to cover negative data too', () => {
    // Regression: Recharts widens a [0, upperBound] domain to fit negative
    // data, stranding a domain-only tick list in a sliver at the top.
    const bounds = computeYAxisBounds(
      [{ a: -100 }, { a: 1 }],
      [series('a')],
      false,
      false,
      DisplayType.Line,
      [],
    );
    expect(bounds).toEqual({
      domain: [-100, 1.05],
      ticks: [-100, -75, -50, -25, 0],
      tickFormatter: expect.any(Function),
    });
  });

  it('pads an all-negative series away from zero, not toward it', () => {
    // Regression: max * 1.05 made the upper bound *more* negative than max
    // itself (-900 * 1.05 = -945), excluding the data's own maximum.
    const bounds = computeYAxisBounds(
      [{ a: -1000 }, { a: -900 }],
      [series('a')],
      false,
      false,
      DisplayType.Line,
      [],
    );
    expect(bounds).toEqual({
      domain: [-1000, -850],
      ticks: [-1000, -950, -900, -850],
      tickFormatter: expect.any(Function),
    });
  });

  it('defers entirely to Recharts when a reference line is present', () => {
    // A fully numeric domain reproduces the exact uneven spacing this PR
    // fixes, and a reference line can extend it further - fall back to auto.
    const bounds = computeYAxisBounds(
      [{ a: 1000 }],
      [series('a')],
      false,
      false,
      DisplayType.Line,
      [1500],
    );
    expect(bounds).toEqual({ domain: [0, 'auto'], ticks: undefined });
  });

  it('leaves a stacked bar`s max to Recharts, selection or not', () => {
    // Regression: 60 and 40 individually reach a stack height of 100, not
    // 63 - the guard must apply regardless of hasSelection.
    const lineData = [series('a'), series('b')];
    const graphResults = [{ a: 60, b: 40 }];
    for (const hasSelection of [false, true]) {
      expect(
        computeYAxisBounds(
          graphResults,
          lineData,
          hasSelection,
          false,
          DisplayType.StackedBar,
          [],
        ),
      ).toEqual({ domain: [0, 'auto'], ticks: undefined });
    }
  });

  it('falls back to auto when there is no numeric data', () => {
    const bounds = computeYAxisBounds(
      [],
      [],
      false,
      false,
      DisplayType.Line,
      [],
    );
    expect(bounds).toEqual({ domain: [0, 'auto'], ticks: undefined });
  });

  it('falls back to auto for flat data instead of a degenerate domain', () => {
    // Regression: an all-zero domain ([0, 0]) collapsed the axis to one point.
    const bounds = computeYAxisBounds(
      [{ a: 0 }, { a: 0 }],
      [series('a')],
      false,
      false,
      DisplayType.Line,
      [],
    );
    expect(bounds).toEqual({ domain: [0, 'auto'], ticks: undefined });
  });

  it('falls back to auto for flat negative data on a fitted axis', () => {
    // Regression: the same guard could also invert the domain (e.g.
    // [0, -5]) for all-negative data padded past zero.
    const bounds = computeYAxisBounds(
      [{ a: -50 }, { a: -50 }],
      [series('a')],
      false,
      true,
      DisplayType.Line,
      [],
    );
    expect(bounds).toEqual({ domain: ['auto', 'auto'], ticks: undefined });
  });

  it('keeps the zero-pinned fallback for flat selected data when not fitting', () => {
    // Regression: this case used the fit fallback (`['auto','auto']`)
    // even though only fit-to-data, not selection, should opt out of it.
    const bounds = computeYAxisBounds(
      [{ a: 100 }, { a: 100 }],
      [series('a')],
      true,
      false,
      DisplayType.Line,
      [],
    );
    expect(bounds).toEqual({ domain: [0, 'auto'], ticks: undefined });
  });

  it('lets a fitted axis follow a negative minimum without expanding the domain', () => {
    const bounds = computeYAxisBounds(
      [{ a: -50 }, { a: 200 }],
      [series('a')],
      false,
      true,
      DisplayType.Line,
      [],
    );
    expect(bounds).toEqual({
      domain: [-62.5, 212.5],
      ticks: [0, 100, 200],
      tickFormatter: expect.any(Function),
    });
  });

  it('extends a selection`s lower bound to negative data even without fitting', () => {
    // Regression: `Math.max(0, ...)` pinned this at 0 even though min < 0,
    // but Recharts widens the domain to the real minimum regardless.
    const bounds = computeYAxisBounds(
      [{ a: -100 }, { a: 100 }],
      [series('a')],
      true,
      false,
      DisplayType.Line,
      [],
    );
    expect(bounds).toEqual({
      domain: [-110, 110],
      ticks: [-100, -50, 0, 50, 100],
      tickFormatter: expect.any(Function),
    });
  });

  it('nice-steps normally when a reference line already sits inside the range', () => {
    // Regression: bailing to ticks: undefined dropped the duplicate-label
    // dedup an alert chart (always has a reference line) used to get.
    const bounds = computeYAxisBounds(
      [{ a: 100 }, { a: 200 }],
      [series('a')],
      false,
      true,
      DisplayType.Line,
      [150],
    );
    expect(bounds).toEqual({
      domain: [95, 205],
      ticks: [100, 125, 150, 175, 200],
      tickFormatter: expect.any(Function),
    });
  });

  it('extends the domain to include an out-of-range reference line, then nice-steps it', () => {
    // A threshold beyond the data (e.g. Alerts.tsx's ifOverflow="extendDomain")
    // widens the rendered domain - ticking it up front avoids stale ticks.
    const bounds = computeYAxisBounds(
      [{ a: 100 }, { a: 200 }],
      [series('a')],
      false,
      true,
      DisplayType.Line,
      [300],
    );
    expect(bounds).toEqual({
      domain: [95, 300],
      ticks: [100, 150, 200, 250, 300],
      tickFormatter: expect.any(Function),
    });
  });

  it('escalates precision instead of dropping a step whose labels collide', () => {
    // Regression: step 500's "0,500,1k,2k,2k" labels collide - escalating
    // precision keeps the denser step instead of falling back to a coarser one.
    const bounds = computeYAxisBounds(
      [{ a: 2000 }],
      [series('a')],
      false,
      false,
      DisplayType.Line,
      [],
      { output: 'number' },
    );
    expect(bounds.domain).toEqual([0, 2100]);
    expect(bounds.ticks).toEqual([0, 500, 1000, 1500, 2000]);
    const labels = bounds.ticks!.map(t => bounds.tickFormatter!(t));
    expect(new Set(labels).size).toBe(labels.length);
  });

  it('never collapses to a single tick, escalating precision or a wider step instead', () => {
    // Regression: a narrow byte range at 0 decimals (2.9-3.4GB) all rounds
    // to "3 GB" - never show duplicate ticks or a no-scale single tick.
    const GB = 1024 ** 3;
    const bounds = computeYAxisBounds(
      [{ a: 2.9 * GB }, { a: 3.4 * GB }],
      [series('a')],
      false,
      true,
      DisplayType.Line,
      [],
      { output: 'byte', mantissa: 0 },
    );
    expect(bounds.ticks).toBeDefined();
    expect(bounds.ticks!.length).toBeGreaterThanOrEqual(2);
    const labels = bounds.ticks!.map(t => bounds.tickFormatter!(t));
    expect(new Set(labels).size).toBe(labels.length);
  });

  it('falls back to getYAxisTicks when no nice step fits, instead of a raw duplicate-prone domain', () => {
    // Regression: no nice step fit this range, leaving ticks undefined for
    // Recharts' raw domain-division default - which collides.
    const GB = 1024 ** 3;
    const bounds = computeYAxisBounds(
      [{ a: 3.269 * GB }, { a: 3.511 * GB }],
      [series('a')],
      false,
      true,
      DisplayType.Line,
      [],
      { output: 'byte', mantissa: 1 },
    );
    expect(bounds.ticks).toBeDefined();
    expect(bounds.ticks!.length).toBeGreaterThanOrEqual(2);
    const labels = bounds.ticks!.map(t => bounds.tickFormatter!(t));
    expect(new Set(labels).size).toBe(labels.length);
  });
});

describe('getYAxisTicks', () => {
  it('resolves the reported duplicate-tick regression with evenly spaced ticks', () => {
    // 5 ticks collide ("3.3/3.3/3.4/3.5/3.5 GB"); dropping duplicates would
    // leave uneven gaps, so this retries at fewer, evenly spaced ticks.
    const GB = 1024 ** 3;
    const format = (v: number) =>
      formatAxisTick(v, { output: 'byte', mantissa: 1 });
    const ticks = getYAxisTicks(3.269 * GB, 3.511 * GB, format);
    expect(ticks.map(format)).toEqual(['3.3 GB', '3.4 GB', '3.5 GB']);
  });

  it('never returns a tick outside the given domain', () => {
    const format = (v: number) => v.toFixed(1);
    const ticks = getYAxisTicks(12.3, 45.6, format);
    expect(ticks[0]).toBe(12.3);
    expect(ticks[ticks.length - 1]).toBe(45.6);
  });

  it('keeps the redundant ticks instead of collapsing to just one', () => {
    // If every count still renders identically, keep the full set rather
    // than misrepresent a varying range as a flat line.
    const ticks = getYAxisTicks(1, 5, () => 'same');
    expect(ticks.length).toBeGreaterThan(1);
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
