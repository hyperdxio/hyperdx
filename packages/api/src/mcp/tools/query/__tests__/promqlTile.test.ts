import { DisplayType, PromqlReducer } from '@hyperdx/common-utils/dist/types';

import {
  buildPromqlTileQueries,
  toPromqlTileResult,
} from '@/mcp/tools/query/promqlTile';

const start = new Date('2026-11-02T10:00:07Z');
const end = new Date('2026-11-02T11:00:07Z');
const dateRange: [Date, Date] = [start, end];
const sec = (iso: string) => new Date(iso).getTime() / 1000;

describe('buildPromqlTileQueries', () => {
  it('sends a range query per expression of a time chart, on the aligned auto step', () => {
    const queries = buildPromqlTileQueries({
      config: {
        displayType: DisplayType.Line,
        promqlExpression: [
          { expression: 'avg_over_time(up[$__interval])' },
          { expression: 'sum(up)' },
        ],
      },
      dateRange,
    });

    // One hour over 80 buckets resolves to 1 minute; the range widens to
    // whole minutes.
    expect(queries.map(q => q.query)).toEqual([
      {
        kind: 'range',
        expr: 'avg_over_time(up[60s])',
        startSec: sec('2026-11-02T10:00:00Z'),
        endSec: sec('2026-11-02T11:01:00Z'),
        stepSec: 60,
      },
      {
        kind: 'range',
        expr: 'sum(up)',
        startSec: sec('2026-11-02T10:00:00Z'),
        endSec: sec('2026-11-02T11:01:00Z'),
        stepSec: 60,
      },
    ]);
  });

  it('sends an instant query at the end of the unaligned range', () => {
    const queries = buildPromqlTileQueries({
      config: {
        displayType: DisplayType.Number,
        promqlExpression: [{ expression: 'sum(up)', queryType: 'instant' }],
      },
      dateRange,
    });

    expect(queries.map(q => q.query)).toEqual([
      { kind: 'instant', expr: 'sum(up)', timeSec: end.getTime() / 1000 },
    ]);
  });

  it("caps an instant table query's series at the table's row cap", () => {
    const [{ query }] = buildPromqlTileQueries({
      config: {
        displayType: DisplayType.Table,
        promqlExpression: [{ expression: 'up', queryType: 'instant' }],
      },
      dateRange,
    });

    expect(query).toMatchObject({ kind: 'instant', limit: 10_000 });
  });

  it("sizes a heatmap's auto step for the heatmap's finer buckets", () => {
    const [{ query }] = buildPromqlTileQueries({
      config: {
        displayType: DisplayType.Heatmap,
        promqlExpression: [{ expression: 'up' }],
      },
      dateRange,
    });

    expect(query).toMatchObject({ kind: 'range', stepSec: 15 });
  });

  it('runs an instant expression on a time chart as a range query', () => {
    const [{ query }] = buildPromqlTileQueries({
      config: {
        displayType: DisplayType.Line,
        promqlExpression: [{ expression: 'up', queryType: 'instant' }],
      },
      dateRange,
    });

    expect(query.kind).toBe('range');
  });

  it('queries only the first expression of a pie tile', () => {
    const queries = buildPromqlTileQueries({
      config: {
        displayType: DisplayType.Pie,
        promqlExpression: [{ expression: 'sum(up)' }, { expression: 'up' }],
      },
      dateRange,
    });

    expect(queries.map(q => q.expression)).toEqual(['sum(up)']);
  });

  it('expands dashboard variables', () => {
    const [{ query }] = buildPromqlTileQueries({
      config: {
        displayType: DisplayType.Line,
        promqlExpression: [{ expression: 'up{job=~"$job"}' }],
      },
      dateRange,
      variables: [{ name: 'job', values: ['checkout'] }],
    });

    expect(query.expr).toContain('checkout');
    expect(query.expr).not.toContain('$job');
  });

  it("floors an auto step at the source's minimum granularity", () => {
    const [{ query }] = buildPromqlTileQueries({
      config: {
        displayType: DisplayType.Line,
        promqlExpression: [{ expression: 'up' }],
      },
      dateRange,
      minGranularitySeconds: 300,
    });

    expect(query).toMatchObject({ kind: 'range', stepSec: 300 });
  });

  it('keeps a granularity the tile picked, unaligned when alignment is off', () => {
    const [{ query }] = buildPromqlTileQueries({
      config: {
        displayType: DisplayType.Line,
        promqlExpression: [{ expression: 'up' }],
        granularity: '15 second',
        alignDateRangeToGranularity: false,
      },
      dateRange,
      minGranularitySeconds: 300,
    });

    expect(query).toEqual({
      kind: 'range',
      expr: 'up',
      startSec: start.getTime() / 1000,
      endSec: end.getTime() / 1000,
      stepSec: 15,
    });
  });
});

describe('toPromqlTileResult', () => {
  const checkout0 = { job: 'checkout', instance: 'checkout-0' };
  const checkout1 = { job: 'checkout', instance: 'checkout-1' };
  const t0 = sec('2026-11-02T10:00:00Z');
  const t1 = sec('2026-11-02T10:01:00Z');

  it('returns time-bucketed rows named by the legend template, labels listed once', () => {
    const result = toPromqlTileResult(
      {
        displayType: DisplayType.Line,
        promqlExpression: 'up',
        legendTemplate: '{{instance}}',
      },
      [
        {
          expression: 'up',
          isBucketed: true,
          result: [
            {
              metric: checkout0,
              values: [
                [t0, 1],
                [t1, 0],
              ],
            },
            { metric: checkout1, values: [[t0, 1]] },
          ],
        },
      ],
    );

    expect(result.data).toEqual([
      {
        __hdx_time_bucket: '2026-11-02T10:00:00.000Z',
        series_name: 'checkout-0',
        value: 1,
      },
      {
        __hdx_time_bucket: '2026-11-02T10:01:00.000Z',
        series_name: 'checkout-0',
        value: 0,
      },
      {
        __hdx_time_bucket: '2026-11-02T10:00:00.000Z',
        series_name: 'checkout-1',
        value: 1,
      },
    ]);
    expect(result.rows).toBe(3);
    expect(result.seriesLabels).toEqual({
      'checkout-0': checkout0,
      'checkout-1': checkout1,
    });
  });

  it('reduces each series of a number tile with its reducer, dropping series with no value', () => {
    const result = toPromqlTileResult(
      {
        displayType: DisplayType.Number,
        promqlExpression: [{ expression: 'up', reducer: PromqlReducer.Max }],
        legendTemplate: '{{instance}}',
      },
      [
        {
          expression: 'up',
          isBucketed: true,
          result: [
            {
              metric: checkout0,
              values: [
                [t0, 2],
                [t1, 5],
              ],
            },
            { metric: checkout1, values: [[t0, NaN]] },
          ],
        },
      ],
    );

    expect(result.data).toEqual([{ series_name: 'checkout-0', value: 5 }]);
    expect(result.seriesLabels).toEqual({ 'checkout-0': checkout0 });
  });

  it('defaults a reduced tile to the last non-null sample', () => {
    const result = toPromqlTileResult(
      { displayType: DisplayType.Bar, promqlExpression: 'up' },
      [
        {
          expression: 'up',
          isBucketed: true,
          result: [
            {
              metric: checkout0,
              values: [
                [t0, 2],
                [t1, 3],
              ],
            },
          ],
        },
      ],
    );

    expect(result.data).toEqual([{ series_name: 'up', value: 3 }]);
  });

  it('gives an instant table a column per label and no time column', () => {
    const result = toPromqlTileResult(
      {
        displayType: DisplayType.Table,
        promqlExpression: [{ expression: 'up', queryType: 'instant' }],
      },
      [
        {
          expression: 'up',
          isBucketed: false,
          result: [
            { metric: checkout0, values: [[t0, 1]] },
            { metric: checkout1, values: [[t0, 0]] },
          ],
        },
      ],
    );

    expect(result.data).toEqual([
      { instance: 'checkout-0', job: 'checkout', Value: 1 },
      { instance: 'checkout-1', job: 'checkout', Value: 0 },
    ]);
    expect(result.meta.map(m => m.name)).toEqual(['instance', 'job', 'Value']);
    // An undefined key would break trimToolResponse on large results.
    expect(result).not.toHaveProperty('seriesLabels');
  });

  it('keys a histogram heatmap by bucket', () => {
    const result = toPromqlTileResult(
      {
        displayType: DisplayType.Heatmap,
        promqlExpression: 'sum by (le) (rate(x_bucket[5m]))',
        heatmap: { mode: 'histogram' },
      },
      [
        {
          expression: 'sum by (le) (rate(x_bucket[5m]))',
          isBucketed: true,
          result: [
            { metric: { le: '0.5' }, values: [[t0, 2]] },
            { metric: { le: '+Inf' }, values: [[t0, 3]] },
          ],
        },
      ],
    );

    expect(result.data).toEqual([
      { __hdx_time_bucket: '2026-11-02T10:00:00.000Z', le: '0.5', value: 2 },
      { __hdx_time_bucket: '2026-11-02T10:00:00.000Z', le: '+Inf', value: 3 },
    ]);
    expect(result).not.toHaveProperty('seriesLabels');
  });
});
