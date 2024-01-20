import _ from 'lodash';
import ms from 'ms';

import * as clickhouse from '@/clickhouse';
import {
  buildMetricSeries,
  clearClickhouseTables,
  getServer,
} from '@/fixtures';

describe('clickhouse - getMultiSeriesChart', () => {
  const server = getServer();

  const now = new Date('2022-01-05').getTime();
  const runId = Math.random().toString(); // dedup watch mode runs
  const teamId = `test`;

  beforeAll(async () => {
    await server.start();
  });

  afterAll(async () => {
    await server.closeHttpServer();
  });

  afterEach(async () => {
    await clearClickhouseTables();
    jest.clearAllMocks();
  });

  beforeEach(async () => {
    await Promise.all([
      // Rate: 8, 1, 8, 25
      clickhouse.bulkInsertTeamMetricStream(
        buildMetricSeries({
          name: 'test.users',
          tags: { host: 'test1', runId, ip: '127.0.0.1' },
          data_type: clickhouse.MetricsDataType.Sum,
          is_monotonic: true,
          is_delta: true,
          unit: 'Users',
          points: [
            { value: 0, timestamp: now - ms('1m') }, // 0
            { value: 1, timestamp: now },
            { value: 8, timestamp: now + ms('4m') }, // 8
            { value: 8, timestamp: now + ms('6m') },
            { value: 9, timestamp: now + ms('9m') }, // 9
            { value: 15, timestamp: now + ms('11m') },
            { value: 17, timestamp: now + ms('14m') }, // 17
            { value: 32, timestamp: now + ms('16m') },
            { value: 42, timestamp: now + ms('19m') }, // 42
          ],
        }),
      ),
      // Rate: 11, 78, 5805, 78729
      // Sum: 12, 79, 5813, 78754
      clickhouse.bulkInsertTeamMetricStream(
        buildMetricSeries({
          name: 'test.users',
          tags: { host: 'test2', runId, ip: '127.0.0.2' },
          data_type: clickhouse.MetricsDataType.Sum,
          is_monotonic: true,
          is_delta: true,
          unit: 'Users',
          points: [
            { value: 3, timestamp: now - ms('1m') }, // 3
            { value: 3, timestamp: now },
            { value: 14, timestamp: now + ms('4m') }, // 14
            { value: 15, timestamp: now + ms('6m') },
            { value: 92, timestamp: now + ms('9m') }, // 92
            { value: 653, timestamp: now + ms('11m') },
            { value: 5897, timestamp: now + ms('14m') }, // 5897
            { value: 9323, timestamp: now + ms('16m') },
            { value: 84626, timestamp: now + ms('19m') }, // 84626
          ],
        }),
      ),
      clickhouse.bulkInsertTeamMetricStream(
        buildMetricSeries({
          name: 'test.cpu',
          tags: { host: 'test1', runId, ip: '127.0.0.1' },
          data_type: clickhouse.MetricsDataType.Gauge,
          is_monotonic: false,
          is_delta: false,
          unit: 'Percent',
          points: [
            { value: 50, timestamp: now },
            { value: 25, timestamp: now + ms('1m') },
            { value: 12.5, timestamp: now + ms('2m') },
            { value: 6.25, timestamp: now + ms('3m') }, // Last 5min
            { value: 100, timestamp: now + ms('6m') },
            { value: 75, timestamp: now + ms('7m') },
            { value: 10, timestamp: now + ms('8m') },
            { value: 80, timestamp: now + ms('9m') }, // Last 5min
          ],
        }),
      ),
      clickhouse.bulkInsertTeamMetricStream(
        buildMetricSeries({
          name: 'test.cpu',
          tags: { host: 'test2', runId, ip: '127.0.0.2' },
          data_type: clickhouse.MetricsDataType.Gauge,
          is_monotonic: false,
          is_delta: false,
          unit: 'Percent',
          points: [
            { value: 1, timestamp: now },
            { value: 2, timestamp: now + ms('1m') },
            { value: 3, timestamp: now + ms('2m') },
            { value: 4, timestamp: now + ms('3m') }, // Last 5min
            { value: 5, timestamp: now + ms('6m') },
            { value: 6, timestamp: now + ms('7m') },
            { value: 5, timestamp: now + ms('8m') },
            { value: 4, timestamp: now + ms('9m') }, // Last 5min
          ],
        }),
      ),
      clickhouse.bulkInsertTeamMetricStream(
        buildMetricSeries({
          name: 'test.two_timestamps_lower_bound',
          tags: { host: 'test2', runId },
          data_type: clickhouse.MetricsDataType.Histogram,
          is_monotonic: false,
          is_delta: false,
          unit: '',
          points: [
            { value: 0, timestamp: now, le: '10' },
            { value: 0, timestamp: now, le: '30' },
            { value: 0, timestamp: now, le: '+Inf' },

            { value: 10, timestamp: now + ms('1m'), le: '10' },
            { value: 10, timestamp: now + ms('1m'), le: '30' },
            { value: 10, timestamp: now + ms('1m'), le: '+Inf' },
          ],
        }),
      ),
      clickhouse.bulkInsertTeamMetricStream(
        buildMetricSeries({
          name: 'test.two_timestamps_lower_bound_inf',
          tags: { host: 'test2', runId },
          data_type: clickhouse.MetricsDataType.Histogram,
          is_monotonic: false,
          is_delta: false,
          unit: '',
          points: [
            { value: 0, timestamp: now, le: '0' },
            { value: 0, timestamp: now, le: '30' },
            { value: 0, timestamp: now, le: '+Inf' },

            { value: 10, timestamp: now + ms('1m'), le: '0' },
            { value: 10, timestamp: now + ms('1m'), le: '30' },
            { value: 10, timestamp: now + ms('1m'), le: '+Inf' },
          ],
        }),
      ),
      clickhouse.bulkInsertTeamMetricStream(
        buildMetricSeries({
          name: 'test.two_timestamps_higher_bound',
          tags: { host: 'test2', runId },
          data_type: clickhouse.MetricsDataType.Histogram,
          is_monotonic: false,
          is_delta: false,
          unit: '',
          points: [
            { value: 0, timestamp: now, le: '10' },
            { value: 0, timestamp: now, le: '30' },
            { value: 0, timestamp: now, le: '50' },

            { value: 0, timestamp: now + ms('1m'), le: '10' },
            { value: 0, timestamp: now + ms('1m'), le: '30' },
            { value: 10, timestamp: now + ms('1m'), le: '50' },
          ],
        }),
      ),
      clickhouse.bulkInsertTeamMetricStream(
        buildMetricSeries({
          name: 'test.two_timestamps_higher_bound_inf',
          tags: { host: 'test2', runId },
          data_type: clickhouse.MetricsDataType.Histogram,
          is_monotonic: false,
          is_delta: false,
          unit: '',
          points: [
            { value: 0, timestamp: now, le: '10' },
            { value: 0, timestamp: now, le: '30' },
            { value: 0, timestamp: now, le: '+Inf' },

            { value: 0, timestamp: now + ms('1m'), le: '10' },
            { value: 0, timestamp: now + ms('1m'), le: '30' },
            { value: 10, timestamp: now + ms('1m'), le: '+Inf' },
          ],
        }),
      ),
      clickhouse.bulkInsertTeamMetricStream(
        buildMetricSeries({
          name: 'test.two_timestamps_zero_offset',
          tags: { host: 'test2', runId },
          data_type: clickhouse.MetricsDataType.Histogram,
          is_monotonic: false,
          is_delta: false,
          unit: '',
          points: [
            { value: 0, timestamp: now, le: '10' },
            { value: 0, timestamp: now, le: '30' },
            { value: 0, timestamp: now, le: '50' },

            { value: 10, timestamp: now + ms('1m'), le: '10' },
            { value: 20, timestamp: now + ms('1m'), le: '30' },
            { value: 50, timestamp: now + ms('1m'), le: '50' },
          ],
        }),
      ),
      clickhouse.bulkInsertTeamMetricStream(
        buildMetricSeries({
          name: 'test.two_timestamps_non_zero_offset',
          tags: { host: 'test2', runId },
          data_type: clickhouse.MetricsDataType.Histogram,
          is_monotonic: false,
          is_delta: false,
          unit: '',
          points: [
            { value: 2, timestamp: now, le: '10' },
            { value: 4, timestamp: now, le: '30' },
            { value: 8, timestamp: now, le: '50' },

            { value: 10, timestamp: now + ms('1m'), le: '10' },
            { value: 20, timestamp: now + ms('1m'), le: '30' },
            { value: 50, timestamp: now + ms('1m'), le: '50' },
          ],
        }),
      ),
    ]);
  });

  it('returns multiple group by labels correctly', async () => {
    const data = (
      await clickhouse.getMultiSeriesChart({
        series: [
          {
            type: 'time',
            table: 'metrics',
            aggFn: clickhouse.AggFn.LastValue,
            field: 'test.cpu',
            where: `runId:${runId}`,
            groupBy: ['host', 'ip'],
            metricDataType: clickhouse.MetricsDataType.Gauge,
          },
        ],
        tableVersion: undefined,
        teamId,
        startTime: now,
        endTime: now + ms('20m'),
        granularity: undefined,
        maxNumGroups: 20,
        seriesReturnType: clickhouse.SeriesReturnType.Column,
      })
    ).data.map(d => {
      return _.pick(d, ['group', 'series_0.data', 'ts_bucket']);
    });

    expect(data).toMatchInlineSnapshot(`
Array [
  Object {
    "group": Array [
      "test1",
      "127.0.0.1",
    ],
    "series_0.data": 80,
    "ts_bucket": "0",
  },
  Object {
    "group": Array [
      "test2",
      "127.0.0.2",
    ],
    "series_0.data": 4,
    "ts_bucket": "0",
  },
]
`);
  });

  it('gauge (last value)', async () => {
    const data = (
      await clickhouse.getMultiSeriesChart({
        series: [
          {
            type: 'time',
            table: 'metrics',
            aggFn: clickhouse.AggFn.LastValue,
            field: 'test.cpu',
            where: `runId:${runId}`,
            groupBy: ['host'],
            metricDataType: clickhouse.MetricsDataType.Gauge,
          },
        ],
        tableVersion: undefined,
        teamId,
        startTime: now,
        endTime: now + ms('20m'),
        granularity: undefined,
        maxNumGroups: 20,
        seriesReturnType: clickhouse.SeriesReturnType.Column,
      })
    ).data.map(d => {
      return _.pick(d, ['group', 'series_0.data', 'ts_bucket']);
    });

    expect(data).toMatchInlineSnapshot(`
Array [
  Object {
    "group": Array [
      "test1",
    ],
    "series_0.data": 80,
    "ts_bucket": "0",
  },
  Object {
    "group": Array [
      "test2",
    ],
    "series_0.data": 4,
    "ts_bucket": "0",
  },
]
`);
  });

  it('sum (rate) + gauge (avg)', async () => {
    const data = (
      await clickhouse.getMultiSeriesChart({
        series: [
          {
            type: 'table',
            table: 'metrics',
            aggFn: clickhouse.AggFn.SumRate,
            field: 'test.users',
            where: `runId:${runId}`,
            groupBy: [],
            metricDataType: clickhouse.MetricsDataType.Sum,
          },
          {
            type: 'time',
            table: 'metrics',
            aggFn: clickhouse.AggFn.Avg,
            field: 'test.cpu',
            where: `runId:${runId}`,
            groupBy: [],
            metricDataType: clickhouse.MetricsDataType.Gauge,
          },
        ],
        tableVersion: undefined,
        teamId,
        startTime: now,
        endTime: now + ms('20m'),
        granularity: undefined,
        maxNumGroups: 20,
        seriesReturnType: clickhouse.SeriesReturnType.Column,
      })
    ).data.map(d => {
      return _.pick(d, [
        'group',
        'series_0.data',
        'series_1.data',
        'ts_bucket',
      ]);
    });

    expect(data).toMatchInlineSnapshot(`
      Array [
        Object {
          "group": Array [],
          "series_0.data": 84665,
          "series_1.data": 42,
          "ts_bucket": "0",
        },
      ]
      `);
  });

  it('two_timestamps_lower_bound histogram (p50)', async () => {
    const p50Data = (
      await clickhouse.getMultiSeriesChart({
        series: [
          {
            type: 'time',
            table: 'metrics',
            aggFn: clickhouse.AggFn.P50,
            field: 'test.two_timestamps_lower_bound',
            where: `runId:${runId}`,
            groupBy: [],
            metricDataType: clickhouse.MetricsDataType.Histogram,
          },
        ],
        tableVersion: undefined,
        teamId,
        startTime: now,
        endTime: now + ms('2m'),
        granularity: '1 minute',
        maxNumGroups: 20,
        seriesReturnType: clickhouse.SeriesReturnType.Column,
      })
    ).data.map(d => {
      return _.pick(d, ['group', 'series_0.data', 'ts_bucket']);
    });

    expect(p50Data).toMatchInlineSnapshot(`
Array [
  Object {
    "group": Array [],
    "series_0.data": 0,
    "ts_bucket": 1641340800,
  },
  Object {
    "group": Array [],
    "series_0.data": 5,
    "ts_bucket": 1641340860,
  },
]
`);
  });

  it('two_timestamps_lower_bound_inf histogram (p50)', async () => {
    const p50Data = (
      await clickhouse.getMultiSeriesChart({
        series: [
          {
            type: 'time',
            table: 'metrics',
            aggFn: clickhouse.AggFn.P50,
            field: 'test.two_timestamps_lower_bound_inf',
            where: `runId:${runId}`,
            groupBy: [],
            metricDataType: clickhouse.MetricsDataType.Histogram,
          },
        ],
        tableVersion: undefined,
        teamId,
        startTime: now,
        endTime: now + ms('2m'),
        granularity: '1 minute',
        maxNumGroups: 20,
        seriesReturnType: clickhouse.SeriesReturnType.Column,
      })
    ).data.map(d => {
      return _.pick(d, ['group', 'series_0.data', 'ts_bucket']);
    });

    expect(p50Data).toMatchInlineSnapshot(`
Array [
  Object {
    "group": Array [],
    "series_0.data": 0,
    "ts_bucket": 1641340800,
  },
  Object {
    "group": Array [],
    "series_0.data": 0,
    "ts_bucket": 1641340860,
  },
]
`);
  });

  it('two_timestamps_higher_bound histogram (p50)', async () => {
    const p50Data = (
      await clickhouse.getMultiSeriesChart({
        series: [
          {
            type: 'time',
            table: 'metrics',
            aggFn: clickhouse.AggFn.P50,
            field: 'test.two_timestamps_higher_bound',
            where: `runId:${runId}`,
            groupBy: [],
            metricDataType: clickhouse.MetricsDataType.Histogram,
          },
        ],
        tableVersion: undefined,
        teamId,
        startTime: now,
        endTime: now + ms('2m'),
        granularity: '1 minute',
        maxNumGroups: 20,
        seriesReturnType: clickhouse.SeriesReturnType.Column,
      })
    ).data.map(d => {
      return _.pick(d, ['group', 'series_0.data', 'ts_bucket']);
    });

    expect(p50Data).toMatchInlineSnapshot(`
Array [
  Object {
    "group": Array [],
    "series_0.data": 0,
    "ts_bucket": 1641340800,
  },
  Object {
    "group": Array [],
    "series_0.data": 40,
    "ts_bucket": 1641340860,
  },
]
`);
  });

  it('two_timestamps_higher_bound_inf histogram (p50)', async () => {
    const p50Data = (
      await clickhouse.getMultiSeriesChart({
        series: [
          {
            type: 'time',
            table: 'metrics',
            aggFn: clickhouse.AggFn.P50,
            field: 'test.two_timestamps_higher_bound_inf',
            where: `runId:${runId}`,
            groupBy: [],
            metricDataType: clickhouse.MetricsDataType.Histogram,
          },
        ],
        tableVersion: undefined,
        teamId,
        startTime: now,
        endTime: now + ms('2m'),
        granularity: '1 minute',
        maxNumGroups: 20,
        seriesReturnType: clickhouse.SeriesReturnType.Column,
      })
    ).data.map(d => {
      return _.pick(d, ['group', 'series_0.data', 'ts_bucket']);
    });

    expect(p50Data).toMatchInlineSnapshot(`
Array [
  Object {
    "group": Array [],
    "series_0.data": 0,
    "ts_bucket": 1641340800,
  },
  Object {
    "group": Array [],
    "series_0.data": 30,
    "ts_bucket": 1641340860,
  },
]
`);
  });

  it('two_timestamps_zero_offset histogram (p50)', async () => {
    const p50Data = (
      await clickhouse.getMultiSeriesChart({
        series: [
          {
            type: 'time',
            table: 'metrics',
            aggFn: clickhouse.AggFn.P50,
            field: 'test.two_timestamps_zero_offset',
            where: `runId:${runId}`,
            groupBy: [],
            metricDataType: clickhouse.MetricsDataType.Histogram,
          },
        ],
        tableVersion: undefined,
        teamId,
        startTime: now,
        endTime: now + ms('2m'),
        granularity: '1 minute',
        maxNumGroups: 20,
        seriesReturnType: clickhouse.SeriesReturnType.Column,
      })
    ).data.map(d => {
      return _.pick(d, ['group', 'series_0.data', 'ts_bucket']);
    });

    expect(p50Data).toMatchInlineSnapshot(`
Array [
  Object {
    "group": Array [],
    "series_0.data": 0,
    "ts_bucket": 1641340800,
  },
  Object {
    "group": Array [],
    "series_0.data": 33.333333333333336,
    "ts_bucket": 1641340860,
  },
]
`);
  });

  it('two_timestamps_non_zero_offset histogram (p50)', async () => {
    const p50Data = (
      await clickhouse.getMultiSeriesChart({
        series: [
          {
            type: 'time',
            table: 'metrics',
            aggFn: clickhouse.AggFn.P50,
            field: 'test.two_timestamps_non_zero_offset',
            where: `runId:${runId}`,
            groupBy: [],
            metricDataType: clickhouse.MetricsDataType.Histogram,
          },
        ],
        tableVersion: undefined,
        teamId,
        startTime: now,
        endTime: now + ms('2m'),
        granularity: '1 minute',
        maxNumGroups: 20,
        seriesReturnType: clickhouse.SeriesReturnType.Column,
      })
    ).data.map(d => {
      return _.pick(d, ['group', 'series_0.data', 'ts_bucket']);
    });

    expect(p50Data).toMatchInlineSnapshot(`
Array [
  Object {
    "group": Array [],
    "series_0.data": 30,
    "ts_bucket": 1641340800,
  },
  Object {
    "group": Array [],
    "series_0.data": 33.84615384615385,
    "ts_bucket": 1641340860,
  },
]
`);
  });

  it('filters using postGroupWhere properly', async () => {
    const queryConfig: Parameters<typeof clickhouse.getMultiSeriesChart>[0] = {
      series: [
        {
          type: 'time',
          table: 'metrics',
          aggFn: clickhouse.AggFn.LastValue,
          field: 'test.cpu',
          where: `runId:${runId}`,
          groupBy: ['host'],
          metricDataType: clickhouse.MetricsDataType.Gauge,
        },
      ],
      tableVersion: undefined,
      teamId,
      startTime: now,
      endTime: now + ms('20m'),
      granularity: undefined,
      maxNumGroups: 20,
      seriesReturnType: clickhouse.SeriesReturnType.Column,
      postGroupWhere: 'series_0:4',
    };

    // Exclude postGroupWhere to assert we get the test data we expect at first
    const data = (
      await clickhouse.getMultiSeriesChart(
        _.omit(queryConfig, ['postGroupWhere']),
      )
    ).data.map(d => {
      return _.pick(d, ['group', 'series_0.data', 'ts_bucket']);
    });

    expect(data).toMatchInlineSnapshot(`
Array [
  Object {
    "group": Array [
      "test1",
    ],
    "series_0.data": 80,
    "ts_bucket": "0",
  },
  Object {
    "group": Array [
      "test2",
    ],
    "series_0.data": 4,
    "ts_bucket": "0",
  },
]
`);

    const filteredData = (
      await clickhouse.getMultiSeriesChart(queryConfig)
    ).data.map(d => {
      return _.pick(d, ['group', 'series_0.data', 'ts_bucket']);
    });

    expect(filteredData).toMatchInlineSnapshot(`
Array [
  Object {
    "group": Array [
      "test2",
    ],
    "series_0.data": 4,
    "ts_bucket": "0",
  },
]
`);
  });
});
