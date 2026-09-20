import { describe, expect, it } from '@jest/globals';

import { NumericUnit } from '@hyperdx/common-utils/dist/types';

import { axisTickFormatter } from '@/shared/formatNumber';

// Mirrors packages/app/src/__tests__/HDXMultiSeriesTimeChart.test.ts's
// formatAxisTick suite - this file is a documented @source port of that
// function (see formatNumber.ts's axisTickFormatter docblock) and is
// expected to stay behaviorally in sync with it.
describe('axisTickFormatter', () => {
  it('returns undefined when the chart has no number format', () => {
    expect(axisTickFormatter(undefined)).toBeUndefined();
  });

  it('falls back to mantissa 0 when the format has none configured', () => {
    const format = axisTickFormatter({ output: 'number' });
    expect(format?.(1234)).toBe('1k');
  });

  it('honors an explicit mantissa instead of always rounding to 0', () => {
    const format = axisTickFormatter({ output: 'number', mantissa: 2 });
    expect(format?.(0.14)).toBe('0.14');
  });

  it('caps mantissa at 2 instead of honoring the Decimals setting outright', () => {
    const format = axisTickFormatter({ output: 'number', mantissa: 10 });
    expect(format?.(0.14)).toBe('0.14');
  });

  it('searches downward for the most precision that still fits the axis budget', () => {
    const format = axisTickFormatter({ output: 'number', mantissa: 2 });
    expect(format?.(200)).toBe('200');
    expect(format?.(10)).toBe('10');
    expect(format?.(-15)).toBe('-15');
    expect(axisTickFormatter({ output: 'number', mantissa: 10 })?.(1234)).toBe(
      '1.23k',
    );
    // Backs off a decimal at a time when full precision would overflow.
    expect(format?.(12340)).toBe('12.3k');
    // Trims only the insignificant trailing zero, keeping the "5".
    expect(format?.(1500)).toBe('1.5k');
    expect(format?.(9.99)).toBe('9.99');
    expect(format?.(-1.5)).toBe('-1.5');
  });

  it('always renders exactly 0 as a bare integer', () => {
    expect(axisTickFormatter({ output: 'number', mantissa: 2 })?.(0)).toBe('0');
    expect(axisTickFormatter({ output: 'byte', mantissa: 1 })?.(0)).toBe('0 B');
  });

  it('applies mantissa to a percent tick`s displayed (x100) value', () => {
    const format = axisTickFormatter({ output: 'percent', mantissa: 2 });
    expect(format?.(0.25)).toBe('25%');
    expect(format?.(0.001)).toBe('0.1%');
  });

  it('preserves shipped byte/throughput tiles that configure a mantissa', () => {
    expect(
      axisTickFormatter({ output: 'byte', mantissa: 1 })?.(268435456),
    ).toBe('256 MB');
    expect(
      axisTickFormatter({ output: 'throughput', mantissa: 2 })?.(1234567),
    ).toBe('1234567');
  });

  it('distinguishes nearby byte values instead of collapsing them', () => {
    // Regression: the axis budget was measured against the whole string,
    // including byte's " MB"/"GB" suffix, so a decimal candidate was
    // always too wide and the search always fell back to mantissa 0.
    const GB = 1024 ** 3;
    expect(axisTickFormatter({ output: 'byte', mantissa: 1 })?.(1.2 * GB)).toBe(
      '1.2 GB',
    );
    expect(axisTickFormatter({ output: 'byte', mantissa: 1 })?.(1.4 * GB)).toBe(
      '1.4 GB',
    );
  });

  it('falls back toward fewer decimals for a long unit suffix instead of overflowing', () => {
    // Regression: exempting the suffix outright let "1.25 Gibit/s" (12
    // chars) pass just because "1.25" alone fit.
    const GIBIT = 1024 ** 3;
    const format = axisTickFormatter({
      output: 'data_rate',
      numericUnit: NumericUnit.BitsSecIEC,
      mantissa: 2,
    });
    expect(format?.(1.25 * GIBIT)).toBe('1 Gibit/s');
  });

  it('does not overflow a shipped byte tile by over-budgeting the unit suffix', () => {
    // Regression: a flat +5 suffix allowance let "281.6 MB" (8 chars)
    // pass, overflowing the terminal gutter on a byte tile.
    expect(
      axisTickFormatter({ output: 'byte', mantissa: 1 })?.(295_279_001),
    ).toBe('282 MB');
  });

  it('keeps a small negative percentage distinguishable from 0', () => {
    // Regression: budget 5 rejected "-0.01%" (sign+suffix together need 6),
    // falling to 1 decimal, which trimmed "-0.0%" to "-0%".
    const format = axisTickFormatter({ output: 'percent', mantissa: 2 });
    expect(format?.(-0.0001)).toBe('-0.01%');
  });

  it('drops the sign from a negative tick that rounds to zero', () => {
    // Regression: throughput's raw toFixed (not numbro) yields "-0.00",
    // trimming to a bare "-0" instead of an unambiguous "0".
    expect(
      axisTickFormatter({ output: 'throughput', mantissa: 2 })?.(-0.001),
    ).toBe('0');
  });

  describe('duration output', () => {
    it('renders minutes with a single-character unit, not "min"', () => {
      expect(axisTickFormatter({ output: 'duration' })?.(799.8)).toBe('13m');
    });

    it('renders seconds compactly', () => {
      expect(axisTickFormatter({ output: 'duration' })?.(39.51)).toBe('39.5s');
    });

    it('respects a configured factor, matching formatNumber`s own duration math', () => {
      expect(
        axisTickFormatter({ output: 'duration', factor: 0.001 })?.(442_800),
      ).toBe('7.4m');
    });

    it('renders sub-millisecond and hour-scale values compactly too', () => {
      expect(axisTickFormatter({ output: 'duration' })?.(0.0000005)).toBe(
        '500ns',
      );
      expect(axisTickFormatter({ output: 'duration' })?.(7500)).toBe('2.1h');
    });
  });
});
