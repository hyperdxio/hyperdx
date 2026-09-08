import { describe, expect, it } from '@jest/globals';

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

  it('honors an explicit mantissa for a tick under the magnitude threshold', () => {
    const format = axisTickFormatter({ output: 'number', mantissa: 2 });
    expect(format?.(0.14)).toBe('0.14');
  });

  it('caps a small tick`s mantissa at 2 instead of honoring it outright', () => {
    const format = axisTickFormatter({ output: 'number', mantissa: 10 });
    expect(format?.(0.14)).toBe('0.14');
  });

  it('forces 0 decimals for any tick >= 10, regardless of configured mantissa', () => {
    const format = axisTickFormatter({ output: 'number', mantissa: 2 });
    expect(format?.(200)).toBe('200');
    expect(format?.(10)).toBe('10');
    expect(format?.(-15)).toBe('-15');
  });

  it('honors configured mantissa up to 9.99 in magnitude, positive or negative', () => {
    const format = axisTickFormatter({ output: 'number', mantissa: 2 });
    expect(format?.(9.99)).toBe('9.99');
    expect(format?.(-1.5)).toBe('-1.50');
  });

  it('always renders exactly 0 as a bare integer', () => {
    expect(axisTickFormatter({ output: 'number', mantissa: 2 })?.(0)).toBe('0');
    expect(axisTickFormatter({ output: 'byte', mantissa: 1 })?.(0)).toBe('0 B');
  });

  it('checks a percent tick`s magnitude against its displayed (x100) value', () => {
    const format = axisTickFormatter({ output: 'percent', mantissa: 2 });
    expect(format?.(0.25)).toBe('25%');
    expect(format?.(0.001)).toBe('0.10%');
  });

  it('preserves shipped byte/throughput tiles that configure a mantissa', () => {
    expect(
      axisTickFormatter({ output: 'byte', mantissa: 1 })?.(268435456),
    ).toBe('256 MB');
    expect(
      axisTickFormatter({ output: 'throughput', mantissa: 2 })?.(1234567),
    ).toBe('1234567');
  });
});
