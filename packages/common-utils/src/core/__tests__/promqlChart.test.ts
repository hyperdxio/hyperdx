import {
  getPromqlChartQueries,
  getPromqlChartRange,
  PromqlChartError,
  reducePromqlChartRows,
  toPromqlChartResult,
  toPromqlHistogramRows,
  toPromqlSamples,
  toPromqlTableRows,
} from '@/core/promqlChart';
import { MAX_TABLE_ROWS } from '@/core/utils';
import { DisplayType, PromqlReducer } from '@/types';

const dateRange: [Date, Date] = [
  new Date('2024-01-01T00:00:30Z'),
  new Date('2024-01-01T01:00:30Z'),
];

const instantResult = (
  metric: Record<string, string>,
  ts: number,
  value: number,
) => ({
  expression: 'up',
  isBucketed: false,
  result: [{ metric, values: [[ts, value]] as [number, number][] }],
});

describe('getPromqlChartRange', () => {
  it('sizes an auto granularity for a time chart and aligns the range to it', () => {
    expect(
      getPromqlChartRange({
        displayType: DisplayType.Line,
        promqlExpression: [{ expression: 'up' }],
        granularity: 'auto',
        dateRange,
      }),
    ).toEqual({
      granularity: '1 minute',
      dateRange: [
        new Date('2024-01-01T00:00:00Z'),
        new Date('2024-01-01T01:01:00Z'),
      ],
    });
  });

  it('sizes an auto granularity for a heatmap for finer buckets', () => {
    expect(
      getPromqlChartRange({
        displayType: DisplayType.Heatmap,
        promqlExpression: [{ expression: 'up' }],
        dateRange,
      }).granularity,
    ).toBe('15 second');
  });

  it("floors an auto granularity at the source's minimum", () => {
    expect(
      getPromqlChartRange({
        displayType: DisplayType.Line,
        promqlExpression: [{ expression: 'up' }],
        dateRange,
        minGranularitySeconds: 300,
      }).granularity,
    ).toBe('5 minute');
  });

  it('leaves the range of a tile that only runs instant queries unaligned', () => {
    expect(
      getPromqlChartRange({
        displayType: DisplayType.Number,
        promqlExpression: [{ expression: 'up', queryType: 'instant' }],
        dateRange,
      }).dateRange,
    ).toEqual(dateRange);
  });

  it('aligns a time chart even when its expressions ask for instant queries', () => {
    expect(
      getPromqlChartRange({
        displayType: DisplayType.Line,
        promqlExpression: [{ expression: 'up', queryType: 'instant' }],
        granularity: '1 minute',
        dateRange,
      }).dateRange[0],
    ).toEqual(new Date('2024-01-01T00:00:00Z'));
  });

  it('leaves the range unaligned when alignment is off', () => {
    expect(
      getPromqlChartRange({
        displayType: DisplayType.Line,
        promqlExpression: [{ expression: 'up' }],
        granularity: '5 minute',
        alignDateRangeToGranularity: false,
        dateRange,
      }),
    ).toEqual({ granularity: '5 minute', dateRange });
  });
});

describe('getPromqlChartQueries', () => {
  const [startSec, endSec] = dateRange.map(d => d.getTime() / 1000);

  it('runs a time chart expression as a range query on the granularity step', () => {
    expect(
      getPromqlChartQueries(
        {
          displayType: DisplayType.Line,
          granularity: '5 minute',
          promqlExpression: [
            { expression: 'up', queryType: 'instant' },
            { expression: 'down' },
          ],
        },
        dateRange,
      ).map(({ query }) => query),
    ).toEqual([
      { kind: 'range', expr: 'up', startSec, endSec, stepSec: 300 },
      { kind: 'range', expr: 'down', startSec, endSec, stepSec: 300 },
    ]);
  });

  it('caps the series of an instant table query, and nothing else', () => {
    const instant = (displayType: DisplayType) =>
      getPromqlChartQueries(
        {
          displayType,
          promqlExpression: [{ expression: 'up', queryType: 'instant' }],
        },
        dateRange,
      )[0].query;

    expect(instant(DisplayType.Table)).toEqual({
      kind: 'instant',
      expr: 'up',
      timeSec: endSec,
      limit: MAX_TABLE_ROWS,
    });
    expect(instant(DisplayType.Number)).toEqual({
      kind: 'instant',
      expr: 'up',
      timeSec: endSec,
      limit: undefined,
    });
  });

  it('expands variables and macros', () => {
    expect(
      getPromqlChartQueries(
        {
          displayType: DisplayType.Line,
          granularity: '1 minute',
          promqlExpression: [
            { expression: 'rate(up{job="$job"}[$__interval])' },
          ],
          variables: [{ name: 'job', values: ['api'] }],
        },
        dateRange,
      )[0].query.expr,
    ).toBe('rate(up{job="api"}[60s])');
  });
});

describe('toPromqlSamples', () => {
  it('reads a scalar as one unlabelled series', () => {
    expect(
      toPromqlSamples({ resultType: 'scalar', result: [1700000000, '2.5'] }),
    ).toEqual({
      isBucketed: false,
      result: [{ metric: {}, values: [[1700000000, 2.5]] }],
    });
  });

  it('rejects a string result', () => {
    expect(() =>
      toPromqlSamples({ resultType: 'string', result: [1700000000, 'a'] }),
    ).toThrow(PromqlChartError);
  });
});

describe('toPromqlChartResult', () => {
  it('names time chart series by the legend template', () => {
    const result = toPromqlChartResult(
      { displayType: DisplayType.Line, legendTemplate: '{{service}}' },
      [
        {
          expression: 'up',
          isBucketed: true,
          result: [{ metric: { service: 'api' }, values: [[1700000000, 1]] }],
        },
      ],
    );
    expect(result.data).toEqual([
      {
        __hdx_time_bucket: '2023-11-14T22:13:20.000Z',
        value: 1,
        series_name: 'api',
      },
    ]);
    expect(result.promqlSeriesLabels).toEqual({ api: { service: 'api' } });
  });

  it('gives a table tile a column per label', () => {
    expect(
      toPromqlChartResult({ displayType: DisplayType.Table }, [
        instantResult({ service: 'api' }, 1, 1),
      ]).data,
    ).toEqual([{ service: 'api', Value: 1 }]);
  });

  it('keys a histogram heatmap by bucket', () => {
    expect(
      toPromqlChartResult(
        { displayType: DisplayType.Heatmap, heatmap: { mode: 'histogram' } },
        [
          {
            expression: 'sum by (le) (x_bucket)',
            isBucketed: true,
            result: [{ metric: { le: '+Inf' }, values: [[1700000000, 4]] }],
          },
        ],
      ).data,
    ).toEqual([
      { __hdx_time_bucket: '2023-11-14T22:13:20.000Z', le: '+Inf', value: 4 },
    ]);
  });
});

describe('reducePromqlChartRows', () => {
  it('reduces each series, dropping series with no usable sample', () => {
    expect(
      reducePromqlChartRows(
        {
          data: [
            { series_name: 'a', value: 1 },
            { series_name: 'a', value: 3 },
            { series_name: 'b', value: NaN },
          ],
        },
        PromqlReducer.Max,
      ).data,
    ).toEqual([{ series_name: 'a', value: 3 }]);
  });
});

describe('toPromqlTableRows', () => {
  it('projects one row per series for an instant query, with no time column', () => {
    const result = toPromqlTableRows([
      {
        expression: 'up',
        isBucketed: false,
        result: [
          {
            metric: { __name__: 'up', service: 'accounting' },
            values: [[1700000000, 1]],
          },
          {
            metric: { __name__: 'up', service: 'billing' },
            values: [[1700000000, 0]],
          },
        ],
      },
    ]);

    expect(result.data).toEqual([
      { __name__: 'up', service: 'accounting', Value: 1 },
      { __name__: 'up', service: 'billing', Value: 0 },
    ]);
    expect(result.meta).toEqual([
      { name: '__name__', type: 'String' },
      { name: 'service', type: 'String' },
      { name: 'Value', type: 'Float64' },
    ]);
    expect(result.rows).toBe(2);
  });

  it('projects one row per sample for a range query, with a time column first', () => {
    const result = toPromqlTableRows([
      {
        expression: 'up',
        isBucketed: true,
        result: [
          {
            metric: { service: 'accounting' },
            values: [
              [1700000000, 1],
              [1700000060, 2],
            ],
          },
        ],
      },
    ]);

    expect(result.data).toEqual([
      {
        Timestamp: '2023-11-14T22:13:20.000Z',
        service: 'accounting',
        Value: 1,
      },
      {
        Timestamp: '2023-11-14T22:14:20.000Z',
        service: 'accounting',
        Value: 2,
      },
    ]);
    expect(Object.keys(result.data[0])).toEqual([
      'Timestamp',
      'service',
      'Value',
    ]);
    expect(result.meta[0]).toEqual({
      name: 'Timestamp',
      type: 'DateTime64(3)',
    });
  });

  it('blanks a label the series does not carry, and orders __name__ first', () => {
    const result = toPromqlTableRows([
      {
        expression: 'up',
        isBucketed: false,
        result: [
          { metric: { pod: 'a', __name__: 'up' }, values: [[1, 1]] },
          { metric: { service: 'billing' }, values: [[1, 2]] },
        ],
      },
    ]);

    expect(result.data).toEqual([
      { __name__: 'up', pod: 'a', service: '', Value: 1 },
      { __name__: '', pod: '', service: 'billing', Value: 2 },
    ]);
  });

  it('renames the reserved columns when a label already uses them', () => {
    const result = toPromqlTableRows([
      {
        expression: 'up',
        isBucketed: true,
        result: [
          {
            metric: { Timestamp: 'noon', Value: 'high' },
            values: [[1700000000, 7]],
          },
        ],
      },
    ]);

    expect(result.data).toEqual([
      {
        Timestamp_1: '2023-11-14T22:13:20.000Z',
        Timestamp: 'noon',
        Value: 'high',
        Value_1: 7,
      },
    ]);
    expect(result.meta).toEqual([
      { name: 'Timestamp_1', type: 'DateTime64(3)' },
      { name: 'Timestamp', type: 'String' },
      { name: 'Value', type: 'String' },
      { name: 'Value_1', type: 'Float64' },
    ]);
  });

  it('caps the rows it returns', () => {
    const result = toPromqlTableRows(
      [
        {
          expression: 'up',
          isBucketed: true,
          result: [
            {
              metric: { service: 'accounting' },
              values: Array.from(
                { length: 10 },
                (_, i) => [1700000000 + i, i] as [number, number],
              ),
            },
          ],
        },
      ],
      3,
    );

    expect(result.data).toHaveLength(3);
    expect(result.rows).toBe(3);
  });

  it('unions the labels across expressions', () => {
    const result = toPromqlTableRows([
      instantResult({ service: 'accounting' }, 1, 1),
      instantResult({ pod: 'a' }, 1, 2),
    ]);

    expect(result.data).toEqual([
      { pod: '', service: 'accounting', Value: 1 },
      { pod: 'a', service: '', Value: 2 },
    ]);
  });

  it('returns only a value column when there are no expressions', () => {
    expect(toPromqlTableRows([])).toEqual({
      data: [],
      meta: [{ name: 'Value', type: 'Float64' }],
      rows: 0,
    });
  });

  it('returns only a value column for an instant query that matched nothing', () => {
    expect(
      toPromqlTableRows([{ expression: 'up', isBucketed: false, result: [] }]),
    ).toEqual({
      data: [],
      meta: [{ name: 'Value', type: 'Float64' }],
      rows: 0,
    });
  });

  // The columns come from the series, not the samples, so an empty range
  // result still describes the table it would have filled.
  it('keeps the columns of a range series that has no samples', () => {
    const result = toPromqlTableRows([
      {
        expression: 'up',
        isBucketed: true,
        result: [{ metric: { service: 'web' }, values: [] }],
      },
    ]);

    expect(result.data).toEqual([]);
    expect(result.rows).toBe(0);
    expect(result.meta).toEqual([
      { name: 'Timestamp', type: 'DateTime64(3)' },
      { name: 'service', type: 'String' },
      { name: 'Value', type: 'Float64' },
    ]);
  });

  it('handles label keys that collide with Object.prototype members', () => {
    const result = toPromqlTableRows([
      instantResult(JSON.parse('{"constructor":"a","__proto__":"b"}'), 1, 1),
      instantResult({ pod: 'x' }, 1, 2),
    ]);

    expect(result.meta.map(({ name }) => name)).toEqual([
      '__proto__',
      'constructor',
      'pod',
      'Value',
    ]);
    expect(Object.entries(result.data[0])).toEqual([
      ['__proto__', 'b'],
      ['constructor', 'a'],
      ['pod', ''],
      ['Value', 1],
    ]);
    expect(Object.entries(result.data[1])).toEqual([
      ['__proto__', ''],
      ['constructor', ''],
      ['pod', 'x'],
      ['Value', 2],
    ]);
  });
});

describe('toPromqlHistogramRows', () => {
  const bucket = (metric: Record<string, string>, value: number) => ({
    metric,
    values: [[1700000000, value]] as [number, number][],
  });
  const rangeResult = (...result: ReturnType<typeof bucket>[]) => ({
    expression: 'sum by (le) (rate(x_bucket[5m]))',
    isBucketed: true,
    result,
  });

  it('keys each sample by its le label', () => {
    const result = toPromqlHistogramRows([
      rangeResult(bucket({ le: '0.5' }, 2), bucket({ le: '+Inf' }, 3)),
    ]);
    expect(result.data).toEqual([
      { __hdx_time_bucket: '2023-11-14T22:13:20.000Z', le: '0.5', value: 2 },
      { __hdx_time_bucket: '2023-11-14T22:13:20.000Z', le: '+Inf', value: 3 },
    ]);
    expect(result.meta.map(({ name }) => name)).toEqual([
      '__hdx_time_bucket',
      'le',
      'value',
    ]);
  });

  it.each<Record<string, string>>([{}, { le: '' }, { le: 'abc' }])(
    'rejects a series without a numeric le: %p',
    metric => {
      expect(() =>
        toPromqlHistogramRows([rangeResult(bucket(metric, 1))]),
      ).toThrow(/need series with an "le" label/);
    },
  );

  it('rejects buckets that were not aggregated by le', () => {
    expect(() =>
      toPromqlHistogramRows([
        rangeResult(
          bucket({ le: '0.5', instance: 'a' }, 1),
          bucket({ le: '0.5', instance: 'b' }, 1),
        ),
      ]),
    ).toThrow('Several series share le="0.5"');
  });
});
