import { DisplayType } from '@hyperdx/common-utils/dist/types';

import { prometheusApi } from '@/api';
import { queryPromqlChartConfig, toTableRows } from '@/utils/promqlChartQuery';

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
  });

  it("caps an instant table query's series at the table's row cap", async () => {
    await queryPromqlChartConfig(
      {
        configType: 'promql',
        displayType: DisplayType.Table,
        connection: 'conn',
        promqlExpression: [{ expression: 'up', queryType: 'instant' }],
      },
      dateRange,
      new AbortController().signal,
    );

    expect(prometheusApi.query).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 10_000 }),
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
        promqlExpression: [{ expression: 'up', queryType: 'instant' }],
      },
      dateRange,
      new AbortController().signal,
    );

    expect(prometheusApi.query).toHaveBeenCalledWith(
      expect.objectContaining({ limit: undefined }),
    );
  });
});
