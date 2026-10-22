import { DisplayType } from '@hyperdx/common-utils/dist/types';

import { prometheusApi } from '@/api';
import {
  queryPromqlChartConfig,
  toHistogramRows,
  toTableRows,
} from '@/utils/promqlChartQuery';

// The real module is a Mantine/TanStack table component; only the row cap is
// needed here.
jest.mock('@/HDXMultiSeriesTableChart', () => ({
  MAX_TABLE_ROWS: 10_000,
}));

jest.mock('@/api', () => ({
  prometheusApi: { query: jest.fn(), queryRange: jest.fn() },
}));

const instantResult = (
  metric: Record<string, string>,
  ts: number,
  value: number,
) => ({
  expression: 'up',
  isBucketed: false,
  result: [{ metric, values: [[ts, value]] as [number, number][] }],
});

describe('toTableRows', () => {
  it('projects one row per series for an instant query, with no time column', () => {
    const result = toTableRows([
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
    const result = toTableRows([
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
    expect(result.meta?.[0]).toEqual({
      name: 'Timestamp',
      type: 'DateTime64(3)',
    });
  });

  it('blanks a label the series does not carry, and orders __name__ first', () => {
    const result = toTableRows([
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
    const result = toTableRows([
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
    const result = toTableRows(
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
    const result = toTableRows([
      instantResult({ service: 'accounting' }, 1, 1),
      instantResult({ pod: 'a' }, 1, 2),
    ]);

    expect(result.data).toEqual([
      { pod: '', service: 'accounting', Value: 1 },
      { pod: 'a', service: '', Value: 2 },
    ]);
  });

  it('returns only a value column when there are no expressions', () => {
    expect(toTableRows([])).toEqual({
      data: [],
      meta: [{ name: 'Value', type: 'Float64' }],
      rows: 0,
      isComplete: true,
    });
  });

  it('returns only a value column for an instant query that matched nothing', () => {
    expect(
      toTableRows([{ expression: 'up', isBucketed: false, result: [] }]),
    ).toEqual({
      data: [],
      meta: [{ name: 'Value', type: 'Float64' }],
      rows: 0,
      isComplete: true,
    });
  });

  // The columns come from the series, not the samples, so an empty range
  // result still describes the table it would have filled.
  it('keeps the columns of a range series that has no samples', () => {
    const result = toTableRows([
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
    const result = toTableRows([
      instantResult(JSON.parse('{"constructor":"a","__proto__":"b"}'), 1, 1),
      instantResult({ pod: 'x' }, 1, 2),
    ]);

    expect(result.meta?.map(({ name }) => name)).toEqual([
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

describe('toHistogramRows', () => {
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
    const result = toHistogramRows([
      rangeResult(bucket({ le: '0.5' }, 2), bucket({ le: '+Inf' }, 3)),
    ]);
    expect(result.data).toEqual([
      { __hdx_time_bucket: '2023-11-14T22:13:20.000Z', le: '0.5', value: 2 },
      { __hdx_time_bucket: '2023-11-14T22:13:20.000Z', le: '+Inf', value: 3 },
    ]);
    expect(result.meta?.map(({ name }) => name)).toEqual([
      '__hdx_time_bucket',
      'le',
      'value',
    ]);
  });

  it.each<Record<string, string>>([{}, { le: '' }, { le: 'abc' }])(
    'rejects a series without a numeric le: %p',
    metric => {
      expect(() => toHistogramRows([rangeResult(bucket(metric, 1))])).toThrow(
        /need series with an "le" label/,
      );
    },
  );

  it('rejects buckets that were not aggregated by le', () => {
    expect(() =>
      toHistogramRows([
        rangeResult(
          bucket({ le: '0.5', instance: 'a' }, 1),
          bucket({ le: '0.5', instance: 'b' }, 1),
        ),
      ]),
    ).toThrow('Several series share le="0.5"');
  });
});

describe('queryPromqlChartConfig', () => {
  const dateRange: [Date, Date] = [
    new Date('2024-01-01T00:00:00Z'),
    new Date('2024-01-01T01:00:00Z'),
  ];

  beforeEach(() => {
    jest
      .mocked(prometheusApi.query)
      .mockReset()
      .mockResolvedValue({
        status: 'success',
        data: { resultType: 'vector', result: [] },
      });
    jest
      .mocked(prometheusApi.queryRange)
      .mockReset()
      .mockResolvedValue({
        status: 'success',
        data: { resultType: 'matrix', result: [] },
      });
  });

  // The server resolves the table from the source, so the table a config still
  // carries must not be sent.
  it.each([
    ['instant', prometheusApi.query],
    ['range', prometheusApi.queryRange],
  ] as const)(
    'names only the source on a %s query',
    async (queryType, endpoint) => {
      await queryPromqlChartConfig(
        {
          configType: 'promql',
          displayType: DisplayType.Number,
          connection: 'conn',
          source: 'source-promql',
          from: { databaseName: 'db', tableName: 'tbl' },
          promqlExpression: [{ expression: 'up', queryType }],
        },
        dateRange,
        new AbortController().signal,
        {},
      );

      const params = jest.mocked(endpoint).mock.calls[0][0];
      expect(params).toHaveProperty('sourceId', 'source-promql');
      expect(params).not.toHaveProperty('connectionId');
      expect(params).not.toHaveProperty('database');
      expect(params).not.toHaveProperty('table');
    },
  );

  it("caps an instant table query's series at the table's row cap", async () => {
    await queryPromqlChartConfig(
      {
        configType: 'promql',
        displayType: DisplayType.Table,
        connection: 'conn',
        source: 'source-promql',
        promqlExpression: [{ expression: 'up', queryType: 'instant' }],
      },
      dateRange,
      new AbortController().signal,
      {},
    );

    expect(prometheusApi.query).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 10_000 }),
    );
  });

  it('passes the attribution through to the request', async () => {
    const attribution = { surface: 'dashboard' as const, tile: 'tile-1' };
    await queryPromqlChartConfig(
      {
        configType: 'promql',
        displayType: DisplayType.Table,
        connection: 'conn',
        source: 'source-promql',
        promqlExpression: [{ expression: 'up', queryType: 'instant' }],
      },
      dateRange,
      new AbortController().signal,
      attribution,
    );

    expect(prometheusApi.query).toHaveBeenCalledWith(
      expect.objectContaining({ attribution }),
    );
  });

  // A number tile warns when an expression yields several series, so it needs
  // to see all of them.
  it('leaves an instant number query uncapped', async () => {
    await queryPromqlChartConfig(
      {
        configType: 'promql',
        displayType: DisplayType.Number,
        connection: 'conn',
        source: 'source-promql',
        promqlExpression: [{ expression: 'up', queryType: 'instant' }],
      },
      dateRange,
      new AbortController().signal,
      {},
    );

    expect(prometheusApi.query).toHaveBeenCalledWith(
      expect.objectContaining({ limit: undefined }),
    );
  });

  describe('series labels of a time chart', () => {
    const t0 = dateRange[0].getTime() / 1000;
    const mockRange = (...metrics: Record<string, string>[][]) => {
      const mock = jest.mocked(prometheusApi.queryRange).mockReset();
      for (const series of metrics) {
        mock.mockResolvedValueOnce({
          status: 'success',
          data: {
            resultType: 'matrix',
            result: series.map(metric => ({
              metric,
              values: [[t0, '1']],
            })),
          },
        });
      }
    };
    const query = (
      promqlExpression: { expression: string }[],
      legendTemplate?: string,
    ) =>
      queryPromqlChartConfig(
        {
          configType: 'promql',
          displayType: DisplayType.Line,
          source: 'source-promql',
          connection: 'conn',
          granularity: '1 minute',
          legendTemplate,
          promqlExpression,
        },
        dateRange,
        new AbortController().signal,
        {},
      );

    it('keys each series by its name', async () => {
      mockRange([
        { __name__: 'up', service: 'api' },
        { __name__: 'up', service: 'web' },
      ]);
      const result = await query([{ expression: 'up' }]);
      const names = result.data.map(row => row.series_name);
      expect(result.promqlSeriesLabels).toEqual({
        [names[0]]: { __name__: 'up', service: 'api' },
        [names[1]]: { __name__: 'up', service: 'web' },
      });
    });

    it('keys series by their legend-template name', async () => {
      mockRange([{ service: 'api', pod: 'a' }]);
      const result = await query([{ expression: 'up' }], '{{service}}');
      expect(result.promqlSeriesLabels).toEqual({
        api: { service: 'api', pod: 'a' },
      });
    });

    it('covers every expression', async () => {
      mockRange([{ service: 'api' }], [{ job: 'db' }]);
      const result = await query([
        { expression: 'up' },
        { expression: 'down' },
      ]);
      expect(Object.values(result.promqlSeriesLabels ?? {})).toEqual([
        { service: 'api' },
        { job: 'db' },
      ]);
    });
  });

  it('runs a heatmap as a range query of its first expression', async () => {
    jest
      .mocked(prometheusApi.queryRange)
      .mockReset()
      .mockResolvedValue({
        status: 'success',
        data: {
          resultType: 'matrix',
          result: [
            {
              metric: { job: 'api', instance: 'a' },
              values: [[dateRange[0].getTime() / 1000, '1']],
            },
          ],
        },
      });

    const result = await queryPromqlChartConfig(
      {
        configType: 'promql',
        displayType: DisplayType.Heatmap,
        connection: 'conn',
        source: 'source-promql',
        granularity: '5 minute',
        legendTemplate: '{{job}}',
        promqlExpression: [
          {
            expression: 'rate(up{job="$job"}[$__interval])',
            queryType: 'instant',
          },
          { expression: 'down' },
        ],
        variables: [{ name: 'job', values: ['api'] }],
      },
      dateRange,
      new AbortController().signal,
      {},
    );

    expect(prometheusApi.query).not.toHaveBeenCalled();
    expect(prometheusApi.queryRange).toHaveBeenCalledTimes(1);
    expect(prometheusApi.queryRange).toHaveBeenCalledWith(
      expect.objectContaining({
        query: 'rate(up{job="api"}[300s])',
        step: '300s',
      }),
    );
    expect(result.data).toEqual([
      {
        __hdx_time_bucket: dateRange[0].toISOString(),
        value: 1,
        series_name: 'api',
      },
    ]);
  });

  it('keys a histogram heatmap rows by bucket, not series name', async () => {
    jest
      .mocked(prometheusApi.queryRange)
      .mockReset()
      .mockResolvedValue({
        status: 'success',
        data: {
          resultType: 'matrix',
          result: [
            {
              metric: { le: '+Inf' },
              values: [[dateRange[0].getTime() / 1000, '4']],
            },
          ],
        },
      });

    const result = await queryPromqlChartConfig(
      {
        configType: 'promql',
        displayType: DisplayType.Heatmap,
        connection: 'conn',
        source: 'source-promql',
        legendTemplate: '{{job}}',
        promqlExpression: [{ expression: 'sum by (le) (x_bucket)' }],
        heatmap: { mode: 'histogram' },
      },
      dateRange,
      new AbortController().signal,
      {},
    );

    expect(prometheusApi.queryRange).toHaveBeenCalledWith(
      expect.objectContaining({ query: 'sum by (le) (x_bucket)' }),
    );
    expect(result.data).toEqual([
      { __hdx_time_bucket: dateRange[0].toISOString(), le: '+Inf', value: 4 },
    ]);
  });
});
