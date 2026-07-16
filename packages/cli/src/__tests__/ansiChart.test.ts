import { describe, expect, it } from '@jest/globals';

import {
  renderLineChart,
  renderStackedBarChart,
  resampleSeries,
  stripAnsi,
} from '@/shared/ansiChart';
import type { TimeChartData } from '@/shared/chartData';

describe('resampleSeries', () => {
  it('returns the input unchanged when lengths match', () => {
    const values = [1, 2, 3, 4];
    expect(resampleSeries(values, 4)).toEqual(values);
  });

  it('handles empty input and non-positive target lengths', () => {
    expect(resampleSeries([], 10)).toEqual([]);
    expect(resampleSeries([1, 2], 0)).toEqual([]);
  });

  it('fills the target with a single repeated value', () => {
    expect(resampleSeries([7], 4)).toEqual([7, 7, 7, 7]);
  });

  describe('upsampling', () => {
    it('preserves 0/1 spikes at exactly 1 (uniform heights)', () => {
      // A 0→1→0→1→0 series must render every spike at exactly 1 —
      // plain linear resampling attenuated these to ~0.94.
      const out = resampleSeries([0, 1, 0, 1, 0], 148);
      expect(Math.max(...out)).toBe(1);
      expect(out.filter(v => v === 1)).toHaveLength(2);
      expect(out.filter(v => v === 0).length).toBeGreaterThanOrEqual(3);
    });

    it('preserves every original bucket value exactly', () => {
      const values = [0, 26, 3, 7.5, 0];
      const out = resampleSeries(values, 100);
      for (const v of values) {
        expect(out).toContain(v);
      }
      expect(Math.max(...out)).toBe(26);
    });

    it('keeps first and last values pinned to the edges', () => {
      const out = resampleSeries([5, 1, 9], 50);
      expect(out[0]).toBe(5);
      expect(out[49]).toBe(9);
    });

    it('linearly interpolates between pinned bucket columns', () => {
      const out = resampleSeries([0, 10], 11);
      expect(out).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    });

    it('produces monotonic output for monotonic input', () => {
      const out = resampleSeries([1, 2, 3, 4, 5], 60);
      for (let i = 1; i < out.length; i++) {
        expect(out[i]).toBeGreaterThanOrEqual(out[i - 1]);
      }
    });
  });

  describe('downsampling', () => {
    it('never drops a narrow spike', () => {
      const values = new Array<number>(1000).fill(0);
      values[500] = 5;
      const out = resampleSeries(values, 100);
      expect(out).toHaveLength(100);
      expect(Math.max(...out)).toBe(5);
    });

    it('keeps the max-magnitude value per column, preserving sign', () => {
      const values = new Array<number>(100).fill(1);
      values[10] = -50;
      const out = resampleSeries(values, 10);
      expect(out).toContain(-50);
    });
  });
});

// ---- Renderer integration ---------------------------------------------

function makeTimeChartData(
  seriesValues: Record<string, number[]>,
  startTs = 1_700_000_000,
  stepSeconds = 60,
): TimeChartData {
  const keys = Object.keys(seriesValues);
  const len = seriesValues[keys[0]].length;
  const graphResults = Array.from({ length: len }, (_, i) => {
    const row: Record<string, number | undefined> = {
      ts: startTs + i * stepSeconds,
    };
    for (const key of keys) {
      row[key] = seriesValues[key][i];
    }
    return row;
  });
  const palette = ['blue', 'yellow', 'red', 'green'];
  return {
    graphResults,
    timestampColumn: { name: 'ts', type: 'DateTime' },
    series: keys.map((key, i) => ({
      dataKey: key,
      displayName: key,
      valueColumnName: key,
      color: palette[i % palette.length],
    })),
    groupColumns: [],
    valueColumns: keys,
    isSingleValueColumn: keys.length === 1,
  };
}

describe('renderLineChart', () => {
  it('labels the y-axis max as exactly 1 for a 0/1 series', () => {
    const values = new Array<number>(80).fill(0);
    values[60] = 1;
    values[70] = 1;
    const output = stripAnsi(
      renderLineChart({
        data: makeTimeChartData({ spikes: values }),
        width: 160,
        height: 16,
      }),
    );
    const topLabel = output.split('\n')[0].trim().split(/\s+/)[0];
    expect(topLabel).toBe('1');
    expect(output).not.toContain('0.94');
  });

  it('labels the y-axis max with the true peak value', () => {
    const values = new Array<number>(80).fill(0);
    values[75] = 26;
    const output = stripAnsi(
      renderLineChart({
        data: makeTimeChartData({ requests: values }),
        width: 160,
        height: 16,
      }),
    );
    expect(output.split('\n')[0]).toContain('26');
  });
});

describe('renderStackedBarChart', () => {
  it('keeps a narrow spike visible when buckets exceed columns', () => {
    // 200 buckets on a narrow terminal (plotWidth 28) — the spike
    // bucket must still reach the top row instead of being skipped by
    // nearest-neighbor column mapping.
    const values = new Array<number>(200).fill(1);
    values[137] = 100;
    const output = stripAnsi(
      renderStackedBarChart({
        data: makeTimeChartData({ events: values }),
        width: 40,
        height: 12,
      }),
    );
    const topRow = output.split('\n')[0];
    expect(topRow).toContain('█');
    expect(topRow).toContain('100');
  });
});
