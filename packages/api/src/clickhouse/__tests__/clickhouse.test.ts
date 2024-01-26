import _ from 'lodash';
import ms from 'ms';

import {
  buildEvent,
  buildMetricSeries,
  clearClickhouseTables,
  closeDB,
  getServer,
  mockLogsPropertyTypeMappingsModel,
  mockSpyMetricPropertyTypeMappingsModel,
} from '@/fixtures';
import { LogPlatform, LogType } from '@/utils/logParser';

import * as clickhouse from '..';

describe('clickhouse', () => {
  const server = getServer();

  beforeAll(async () => {
    await server.start();
  });

  afterAll(async () => {
    await server.closeHttpServer();
    await closeDB();
  });

  afterEach(async () => {
    await clearClickhouseTables();
    jest.clearAllMocks();
  });

  it('fetches bulk events correctly', async () => {
    const now = new Date('2022-01-05').getTime();
    const runId = Math.random().toString(); // dedup watch mode runs
    const teamId = `test`;

    await clickhouse.bulkInsertLogStream([
      buildEvent({
        source: 'test',
        timestamp: now,
        platform: LogPlatform.NodeJS,
        type: LogType.Log,
        test: 'test1',
        runId,
      }),
      buildEvent({
        source: 'test',
        timestamp: now + 1,
        platform: LogPlatform.NodeJS,
        type: LogType.Log,
        test: 'test2',
        justanumber: 777,
        runId,
      }),
      buildEvent({
        source: 'test',
        timestamp: now + 1,
        platform: LogPlatform.NodeJS,
        type: LogType.Log,
        justanumber: 777,
        runId,
      }),
    ]);

    const data = (
      await clickhouse.getLogBatch({
        tableVersion: undefined,
        teamId,
        q: `runId:${runId} test:*`,
        limit: 20,
        offset: 0,
        startTime: now - 1,
        endTime: now + 5,
        order: 'desc',
      })
    ).data.map(({ id, ...d }) => d); // pluck non-deterministic id

    expect(data.length).toEqual(2);
    expect(data).toMatchInlineSnapshot(`
Array [
  Object {
    "_host": "",
    "_platform": "nodejs",
    "_service": "test-service",
    "body": "",
    "duration": -1641340800001,
    "severity_text": "",
    "sort_key": "1641340800001000000",
    "timestamp": "2022-01-05T00:00:00.001000000Z",
    "type": "log",
  },
  Object {
    "_host": "",
    "_platform": "nodejs",
    "_service": "test-service",
    "body": "",
    "duration": -1641340800000,
    "severity_text": "",
    "sort_key": "1641340800000000000",
    "timestamp": "2022-01-05T00:00:00.000000000Z",
    "type": "log",
  },
]
`);
  });

  it('fetches multi-series event charts correctly', async () => {
    const now = new Date('2022-01-05').getTime();
    const runId = Math.random().toString(); // dedup watch mode runs
    const teamId = `test`;

    await clickhouse.bulkInsertLogStream([
      // Group 1, sum: 77, avg:25.666666667
      buildEvent({
        timestamp: now,
        runId,
        testGroup: 'group1',
        testOtherGroup: 'otherGroup1',
        awesomeNumber: 1,
      }),
      buildEvent({
        timestamp: now + ms('1m'),
        runId,
        testGroup: 'group1',
        testOtherGroup: 'otherGroup1',
        awesomeNumber: 15,
      }),
      buildEvent({
        timestamp: now + ms('2m'),
        runId,
        testGroup: 'group1',
        testOtherGroup: 'otherGroup2',
        awesomeNumber: 61,
      }),
      // Group 1, sum: 7, avg: 2.3333333
      buildEvent({
        timestamp: now + ms('6m'),
        runId,
        testGroup: 'group1',
        testOtherGroup: 'otherGroup2',
        awesomeNumber: 4,
      }),
      buildEvent({
        timestamp: now + ms('7m'),
        runId,
        testGroup: 'group1',
        testOtherGroup: 'otherGroup2',
        awesomeNumber: 2,
      }),
      buildEvent({
        timestamp: now + ms('8m'),
        runId,
        testGroup: 'group1',
        testOtherGroup: 'otherGroup3',
        awesomeNumber: 1,
      }),
      // Group 2, sum: 777, avg: 259
      buildEvent({
        timestamp: now,
        runId,
        testGroup: 'group2',
        testOtherGroup: 'otherGroup1',
        awesomeNumber: 70,
      }),
      buildEvent({
        timestamp: now + ms('4m'),
        runId,
        testGroup: 'group2',
        testOtherGroup: 'otherGroup1',
        awesomeNumber: 700,
      }),
      buildEvent({
        timestamp: now + ms('1m'),
        runId,
        testGroup: 'group2',
        testOtherGroup: 'otherGroup1',
        awesomeNumber: 7,
      }),
    ]);

    mockLogsPropertyTypeMappingsModel({
      testGroup: 'string',
      testOtherGroup: 'string',
      awesomeNumber: 'number',
      runId: 'string',
    });

    const data = (
      await clickhouse.getMultiSeriesChart({
        series: [
          {
            type: 'time',
            table: 'logs',
            aggFn: clickhouse.AggFn.Sum,
            field: 'awesomeNumber',
            where: `runId:${runId}`,
            groupBy: ['testGroup'],
          },
          {
            type: 'time',
            table: 'logs',
            aggFn: clickhouse.AggFn.Avg,
            field: 'awesomeNumber',
            where: `runId:${runId}`,
            groupBy: ['testGroup'],
          },
        ],
        tableVersion: undefined,
        teamId,
        startTime: now,
        endTime: now + ms('10m'),
        granularity: '5 minute',
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

    expect(data.length).toEqual(3);
    expect(data).toMatchInlineSnapshot(`
Array [
  Object {
    "group": Array [
      "group2",
    ],
    "series_0.data": 777,
    "series_1.data": 259,
    "ts_bucket": 1641340800,
  },
  Object {
    "group": Array [
      "group1",
    ],
    "series_0.data": 77,
    "series_1.data": 25.666666666666668,
    "ts_bucket": 1641340800,
  },
  Object {
    "group": Array [
      "group1",
    ],
    "series_0.data": 7,
    "series_1.data": 2.3333333333333335,
    "ts_bucket": 1641341100,
  },
]
`);
    const multiGroupBysData = (
      await clickhouse.getMultiSeriesChart({
        series: [
          {
            type: 'time',
            table: 'logs',
            aggFn: clickhouse.AggFn.Sum,
            field: 'awesomeNumber',
            where: `runId:${runId}`,
            groupBy: ['testGroup', 'testOtherGroup'],
          },
        ],
        tableVersion: undefined,
        teamId,
        startTime: now,
        endTime: now + ms('10m'),
        granularity: '5 minute',
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
    expect(multiGroupBysData.length).toEqual(5);
    expect(multiGroupBysData).toMatchInlineSnapshot(`
Array [
  Object {
    "group": Array [
      "group2",
      "otherGroup1",
    ],
    "series_0.data": 777,
    "ts_bucket": 1641340800,
  },
  Object {
    "group": Array [
      "group1",
      "otherGroup2",
    ],
    "series_0.data": 61,
    "ts_bucket": 1641340800,
  },
  Object {
    "group": Array [
      "group1",
      "otherGroup1",
    ],
    "series_0.data": 16,
    "ts_bucket": 1641340800,
  },
  Object {
    "group": Array [
      "group1",
      "otherGroup2",
    ],
    "series_0.data": 6,
    "ts_bucket": 1641341100,
  },
  Object {
    "group": Array [
      "group1",
      "otherGroup3",
    ],
    "series_0.data": 1,
    "ts_bucket": 1641341100,
  },
]
`);

    const multiGroupBysData2 = (
      await clickhouse.getMultiSeriesChart({
        series: [
          {
            type: 'time',
            table: 'logs',
            aggFn: clickhouse.AggFn.CountPerMin,
            field: 'awesomeNumber',
            where: `runId:${runId}`,
            groupBy: ['testGroup', 'testOtherGroup'],
          },
        ],
        tableVersion: undefined,
        teamId,
        startTime: now,
        endTime: now + ms('10m'),
        granularity: '5 minute',
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
    expect(multiGroupBysData2.length).toEqual(5);
    expect(multiGroupBysData2).toMatchInlineSnapshot(`
Array [
  Object {
    "group": Array [
      "group2",
      "otherGroup1",
    ],
    "series_0.data": 0.6,
    "ts_bucket": 1641340800,
  },
  Object {
    "group": Array [
      "group1",
      "otherGroup1",
    ],
    "series_0.data": 0.4,
    "ts_bucket": 1641340800,
  },
  Object {
    "group": Array [
      "group1",
      "otherGroup2",
    ],
    "series_0.data": 0.2,
    "ts_bucket": 1641340800,
  },
  Object {
    "group": Array [
      "group1",
      "otherGroup2",
    ],
    "series_0.data": 0.4,
    "ts_bucket": 1641341100,
  },
  Object {
    "group": Array [
      "group1",
      "otherGroup3",
    ],
    "series_0.data": 0.2,
    "ts_bucket": 1641341100,
  },
]
`);

    const ratioData = (
      await clickhouse.getMultiSeriesChart({
        series: [
          {
            type: 'time',
            table: 'logs',
            aggFn: clickhouse.AggFn.Sum,
            field: 'awesomeNumber',
            where: `runId:${runId}`,
            groupBy: ['testGroup'],
          },
          {
            type: 'time',
            table: 'logs',
            aggFn: clickhouse.AggFn.Avg,
            field: 'awesomeNumber',
            where: `runId:${runId}`,
            groupBy: ['testGroup'],
          },
        ],
        tableVersion: undefined,
        teamId,
        startTime: now,
        endTime: now + ms('10m'),
        granularity: '5 minute',
        maxNumGroups: 20,
        seriesReturnType: clickhouse.SeriesReturnType.Ratio,
      })
    ).data.map(d => {
      return _.pick(d, ['group', 'series_0.data', 'ts_bucket']);
    });

    expect(ratioData.length).toEqual(3);
    expect(ratioData).toMatchInlineSnapshot(`
Array [
  Object {
    "group": Array [
      "group1",
    ],
    "series_0.data": 3,
    "ts_bucket": 1641340800,
  },
  Object {
    "group": Array [
      "group2",
    ],
    "series_0.data": 3,
    "ts_bucket": 1641340800,
  },
  Object {
    "group": Array [
      "group1",
    ],
    "series_0.data": 3,
    "ts_bucket": 1641341100,
  },
]
`);

    const tableData = (
      await clickhouse.getMultiSeriesChart({
        series: [
          {
            type: 'table',
            table: 'logs',
            aggFn: clickhouse.AggFn.CountPerMin,
            where: `runId:${runId}`,
            groupBy: ['testGroup'],
          },
        ],
        tableVersion: undefined,
        teamId,
        startTime: now,
        endTime: now + ms('10m'),
        granularity: undefined,
        maxNumGroups: 20,
        seriesReturnType: clickhouse.SeriesReturnType.Column,
      })
    ).data.map(d => {
      return _.pick(d, ['group', 'series_0.data', 'ts_bucket', 'rank']);
    });

    expect(tableData.length).toEqual(2);
    expect(tableData).toMatchInlineSnapshot(`
Array [
  Object {
    "group": Array [
      "group1",
    ],
    "rank": "1",
    "series_0.data": 0.6,
    "ts_bucket": "0",
  },
  Object {
    "group": Array [
      "group2",
    ],
    "rank": "2",
    "series_0.data": 0.3,
    "ts_bucket": "0",
  },
]
`);
  });

  it('fetches multi-series metric time chart correctly', async () => {
    const now = new Date('2022-01-05').getTime();
    const runId = Math.random().toString(); // dedup watch mode runs
    const teamId = `test`;

    // Rate: 8, 1, 8, 25
    await clickhouse.bulkInsertTeamMetricStream(
      buildMetricSeries({
        name: 'test.users',
        tags: { host: 'test1', runId },
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
    );

    // Rate: 11, 78, 5805, 78729
    // Sum: 12, 79, 5813, 78754
    await clickhouse.bulkInsertTeamMetricStream(
      buildMetricSeries({
        name: 'test.users',
        tags: { host: 'test2', runId },
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
    );

    await clickhouse.bulkInsertTeamMetricStream(
      buildMetricSeries({
        name: 'test.cpu',
        tags: { host: 'test1', runId },
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
    );

    await clickhouse.bulkInsertTeamMetricStream(
      buildMetricSeries({
        name: 'test.cpu',
        tags: { host: 'test2', runId },
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
    );

    mockSpyMetricPropertyTypeMappingsModel({
      runId: 'string',
      host: 'string',
    });

    const singleSumSeriesData = (
      await clickhouse.getMultiSeriesChart({
        series: [
          {
            type: 'time',
            table: 'metrics',
            aggFn: clickhouse.AggFn.SumRate,
            field: 'test.users',
            where: `runId:${runId}`,
            groupBy: [],
            metricDataType: clickhouse.MetricsDataType.Sum,
          },
        ],
        tableVersion: undefined,
        teamId,
        startTime: now,
        endTime: now + ms('20m'),
        granularity: '5 minute',
        maxNumGroups: 20,
        seriesReturnType: clickhouse.SeriesReturnType.Column,
      })
    ).data.map(d => {
      return _.pick(d, ['group', 'series_0.data', 'ts_bucket']);
    });

    expect(singleSumSeriesData).toMatchInlineSnapshot(`
Array [
  Object {
    "group": Array [],
    "series_0.data": 19,
    "ts_bucket": 1641340800,
  },
  Object {
    "group": Array [],
    "series_0.data": 79,
    "ts_bucket": 1641341100,
  },
  Object {
    "group": Array [],
    "series_0.data": 5813,
    "ts_bucket": 1641341400,
  },
  Object {
    "group": Array [],
    "series_0.data": 78754,
    "ts_bucket": 1641341700,
  },
]
`);

    const singleGaugeGroupedSeriesData = (
      await clickhouse.getMultiSeriesChart({
        series: [
          {
            type: 'time',
            table: 'metrics',
            aggFn: clickhouse.AggFn.Avg,
            field: 'test.cpu',
            where: `runId:${runId}`,
            groupBy: ['host'],
            metricDataType: clickhouse.MetricsDataType.Gauge,
          },
        ],
        tableVersion: undefined,
        teamId,
        startTime: now,
        endTime: now + ms('10m'),
        granularity: '5 minute',
        maxNumGroups: 20,
        seriesReturnType: clickhouse.SeriesReturnType.Column,
      })
    ).data.map(d => {
      return _.pick(d, ['group', 'series_0.data', 'ts_bucket']);
    });

    expect(singleGaugeGroupedSeriesData).toMatchInlineSnapshot(`
Array [
  Object {
    "group": Array [
      "test1",
    ],
    "series_0.data": 6.25,
    "ts_bucket": 1641340800,
  },
  Object {
    "group": Array [
      "test2",
    ],
    "series_0.data": 4,
    "ts_bucket": 1641340800,
  },
  Object {
    "group": Array [
      "test1",
    ],
    "series_0.data": 80,
    "ts_bucket": 1641341100,
  },
  Object {
    "group": Array [
      "test2",
    ],
    "series_0.data": 4,
    "ts_bucket": 1641341100,
  },
]
`);

    const singleGaugeSeriesData = (
      await clickhouse.getMultiSeriesChart({
        series: [
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
        endTime: now + ms('10m'),
        granularity: '5 minute',
        maxNumGroups: 20,
        seriesReturnType: clickhouse.SeriesReturnType.Column,
      })
    ).data.map(d => {
      return _.pick(d, ['group', 'series_0.data', 'ts_bucket']);
    });

    expect(singleGaugeSeriesData).toMatchInlineSnapshot(`
Array [
  Object {
    "group": Array [],
    "series_0.data": 5.125,
    "ts_bucket": 1641340800,
  },
  Object {
    "group": Array [],
    "series_0.data": 42,
    "ts_bucket": 1641341100,
  },
]
`);

    const singleGaugeSeriesSummedData = (
      await clickhouse.getMultiSeriesChart({
        series: [
          {
            type: 'time',
            table: 'metrics',
            aggFn: clickhouse.AggFn.Sum,
            field: 'test.cpu',
            where: `runId:${runId}`,
            groupBy: [],
            metricDataType: clickhouse.MetricsDataType.Gauge,
          },
        ],
        tableVersion: undefined,
        teamId,
        startTime: now,
        endTime: now + ms('10m'),
        granularity: '5 minute',
        maxNumGroups: 20,
        seriesReturnType: clickhouse.SeriesReturnType.Column,
      })
    ).data.map(d => {
      return _.pick(d, ['group', 'series_0.data', 'ts_bucket']);
    });

    expect(singleGaugeSeriesSummedData).toMatchInlineSnapshot(`
Array [
  Object {
    "group": Array [],
    "series_0.data": 10.25,
    "ts_bucket": 1641340800,
  },
  Object {
    "group": Array [],
    "series_0.data": 84,
    "ts_bucket": 1641341100,
  },
]
`);

    const ratioData = (
      await clickhouse.getMultiSeriesChart({
        series: [
          {
            type: 'time',
            table: 'metrics',
            aggFn: clickhouse.AggFn.Avg,
            field: 'test.cpu',
            where: `runId:${runId}`,
            groupBy: ['host'],
            metricDataType: clickhouse.MetricsDataType.Gauge,
          },
          {
            type: 'time',
            table: 'metrics',
            aggFn: clickhouse.AggFn.SumRate,
            field: 'test.users',
            where: `runId:${runId}`,
            groupBy: ['host'],
            metricDataType: clickhouse.MetricsDataType.Sum,
          },
        ],
        tableVersion: undefined,
        teamId,
        startTime: now,
        endTime: now + ms('20m'),
        granularity: '5 minute',
        maxNumGroups: 20,
        seriesReturnType: clickhouse.SeriesReturnType.Ratio,
      })
    ).data.map(d => {
      return _.pick(d, ['group', 'series_0.data', 'ts_bucket']);
    });

    expect(ratioData).toMatchInlineSnapshot(`
Array [
  Object {
    "group": Array [
      "test1",
    ],
    "series_0.data": 0.78125,
    "ts_bucket": 1641340800,
  },
  Object {
    "group": Array [
      "test2",
    ],
    "series_0.data": 0.36363636363636365,
    "ts_bucket": 1641340800,
  },
  Object {
    "group": Array [
      "test1",
    ],
    "series_0.data": 80,
    "ts_bucket": 1641341100,
  },
  Object {
    "group": Array [
      "test2",
    ],
    "series_0.data": 0.05128205128205128,
    "ts_bucket": 1641341100,
  },
  Object {
    "group": Array [],
    "series_0.data": null,
    "ts_bucket": 1641341400,
  },
  Object {
    "group": Array [],
    "series_0.data": null,
    "ts_bucket": 1641341700,
  },
]
`);
  });

  it('limits groups and sorts multi series charts properly', async () => {
    const now = new Date('2022-01-05').getTime();
    const runId = Math.random().toString(); // dedup watch mode runs
    const teamId = `test`;

    await clickhouse.bulkInsertLogStream(
      Array(10)
        .fill(0)
        .flatMap((_, i) => [
          buildEvent({
            timestamp: now,
            runId,
            testGroup: `group${i}`,
            awesomeNumber: i,
          }),
          buildEvent({
            timestamp: now + ms('6m'),
            runId,
            testGroup: `group${i}`,
            // Make sure that the asc sort order will choose the min data point
            awesomeNumber: i % 2 === 1 ? 20 - i : i,
          }),
        ]),
    );

    mockLogsPropertyTypeMappingsModel({
      testGroup: 'string',
      awesomeNumber: 'number',
      runId: 'string',
    });

    const ascData = (
      await clickhouse.getMultiSeriesChart({
        series: [
          {
            type: 'table',
            table: 'logs',
            aggFn: clickhouse.AggFn.Count,
            field: 'awesomeNumber',
            where: `runId:${runId}`,
            groupBy: ['testGroup'],
            sortOrder: undefined,
          },
          {
            type: 'table',
            table: 'logs',
            aggFn: clickhouse.AggFn.Sum,
            field: 'awesomeNumber',
            where: `runId:${runId}`,
            groupBy: ['testGroup'],
            sortOrder: 'asc',
          },
        ],
        tableVersion: undefined,
        teamId,
        startTime: now,
        endTime: now + ms('10m'),
        granularity: '5 minute',
        maxNumGroups: 3,
        seriesReturnType: clickhouse.SeriesReturnType.Column,
      })
    ).data.map(d =>
      _.pick(d, ['series_0.data', 'series_1.data', 'group', 'ts_bucket']),
    );

    expect(ascData).toMatchInlineSnapshot(`
Array [
  Object {
    "group": Array [
      "group0",
    ],
    "series_0.data": 1,
    "series_1.data": 0,
    "ts_bucket": 1641340800,
  },
  Object {
    "group": Array [
      "group1",
    ],
    "series_0.data": 1,
    "series_1.data": 1,
    "ts_bucket": 1641340800,
  },
  Object {
    "group": Array [
      "group2",
    ],
    "series_0.data": 1,
    "series_1.data": 2,
    "ts_bucket": 1641340800,
  },
  Object {
    "group": Array [
      "group0",
    ],
    "series_0.data": 1,
    "series_1.data": 0,
    "ts_bucket": 1641341100,
  },
  Object {
    "group": Array [
      "group2",
    ],
    "series_0.data": 1,
    "series_1.data": 2,
    "ts_bucket": 1641341100,
  },
  Object {
    "group": Array [
      "group1",
    ],
    "series_0.data": 1,
    "series_1.data": 19,
    "ts_bucket": 1641341100,
  },
]
`);

    const descData = (
      await clickhouse.getMultiSeriesChart({
        series: [
          {
            type: 'table',
            table: 'logs',
            aggFn: clickhouse.AggFn.Count,
            field: 'awesomeNumber',
            where: `runId:${runId}`,
            groupBy: ['testGroup'],
            sortOrder: undefined,
          },
          {
            type: 'table',
            table: 'logs',
            aggFn: clickhouse.AggFn.Sum,
            field: 'awesomeNumber',
            where: `runId:${runId}`,
            groupBy: ['testGroup'],
            sortOrder: 'desc',
          },
        ],
        tableVersion: undefined,
        teamId,
        startTime: now,
        endTime: now + ms('10m'),
        granularity: '5 minute',
        maxNumGroups: 3,
        seriesReturnType: clickhouse.SeriesReturnType.Column,
      })
    ).data.map(d =>
      _.pick(d, ['series_0.data', 'series_1.data', 'group', 'ts_bucket']),
    );

    expect(descData).toMatchInlineSnapshot(`
Array [
  Object {
    "group": Array [
      "group5",
    ],
    "series_0.data": 1,
    "series_1.data": 5,
    "ts_bucket": 1641340800,
  },
  Object {
    "group": Array [
      "group3",
    ],
    "series_0.data": 1,
    "series_1.data": 3,
    "ts_bucket": 1641340800,
  },
  Object {
    "group": Array [
      "group1",
    ],
    "series_0.data": 1,
    "series_1.data": 1,
    "ts_bucket": 1641340800,
  },
  Object {
    "group": Array [
      "group1",
    ],
    "series_0.data": 1,
    "series_1.data": 19,
    "ts_bucket": 1641341100,
  },
  Object {
    "group": Array [
      "group3",
    ],
    "series_0.data": 1,
    "series_1.data": 17,
    "ts_bucket": 1641341100,
  },
  Object {
    "group": Array [
      "group5",
    ],
    "series_0.data": 1,
    "series_1.data": 15,
    "ts_bucket": 1641341100,
  },
]
`);

    const descDataSimple = (
      await clickhouse.getMultiSeriesChart({
        series: [
          {
            type: 'table',
            table: 'logs',
            aggFn: clickhouse.AggFn.Count,
            field: 'awesomeNumber',
            where: `runId:${runId}`,
            groupBy: ['testGroup'],
            sortOrder: undefined,
          },
          {
            type: 'table',
            table: 'logs',
            aggFn: clickhouse.AggFn.Sum,
            field: 'awesomeNumber',
            where: `runId:${runId}`,
            groupBy: ['testGroup'],
            sortOrder: 'desc',
          },
        ],
        tableVersion: undefined,
        teamId,
        startTime: now,
        endTime: now + ms('5m'),
        granularity: '5 minute',
        maxNumGroups: 3,
        seriesReturnType: clickhouse.SeriesReturnType.Column,
      })
    ).data.map(d =>
      _.pick(d, ['series_0.data', 'series_1.data', 'group', 'ts_bucket']),
    );

    expect(descDataSimple).toMatchInlineSnapshot(`
Array [
  Object {
    "group": Array [
      "group9",
    ],
    "series_0.data": 1,
    "series_1.data": 9,
    "ts_bucket": 1641340800,
  },
  Object {
    "group": Array [
      "group8",
    ],
    "series_0.data": 1,
    "series_1.data": 8,
    "ts_bucket": 1641340800,
  },
  Object {
    "group": Array [
      "group7",
    ],
    "series_0.data": 1,
    "series_1.data": 7,
    "ts_bucket": 1641340800,
  },
]
`);
  });

  it('fetches legacy format correctly for alerts', async () => {
    const now = new Date('2022-01-05').getTime();
    const runId = Math.random().toString(); // dedup watch mode runs
    const teamId = `test`;

    await clickhouse.bulkInsertLogStream([
      // Group 1, sum: 77, avg:25.666666667
      buildEvent({
        timestamp: now,
        runId,
        testGroup: 'group1',
        awesomeNumber: 1,
      }),
      buildEvent({
        timestamp: now + ms('1m'),
        runId,
        testGroup: 'group1',
        awesomeNumber: 15,
      }),
      buildEvent({
        timestamp: now + ms('2m'),
        runId,
        testGroup: 'group1',
        awesomeNumber: 61,
      }),
      // Group 1, sum: 7, avg: 2.3333333
      buildEvent({
        timestamp: now + ms('6m'),
        runId,
        testGroup: 'group1',
        awesomeNumber: 4,
      }),
      buildEvent({
        timestamp: now + ms('7m'),
        runId,
        testGroup: 'group1',
        awesomeNumber: 2,
      }),
      buildEvent({
        timestamp: now + ms('8m'),
        runId,
        testGroup: 'group1',
        awesomeNumber: 1,
      }),
      // Group 2, sum: 777, avg: 259
      buildEvent({
        timestamp: now,
        runId,
        testGroup: 'group2',
        awesomeNumber: 70,
      }),
      buildEvent({
        timestamp: now + ms('4m'),
        runId,
        testGroup: 'group2',
        awesomeNumber: 700,
      }),
      buildEvent({
        timestamp: now + ms('1m'),
        runId,
        testGroup: 'group2',
        awesomeNumber: 7,
      }),
    ]);

    const propertyTypeMappingsModel = mockLogsPropertyTypeMappingsModel({
      testGroup: 'string',
      awesomeNumber: 'number',
      runId: 'string',
    });

    const data = (
      await clickhouse.getMultiSeriesChartLegacyFormat({
        series: [
          {
            type: 'time',
            table: 'logs',
            aggFn: clickhouse.AggFn.Sum,
            field: 'awesomeNumber',
            where: `runId:${runId}`,
            groupBy: ['testGroup'],
          },
        ],
        tableVersion: undefined,
        teamId,
        startTime: now,
        endTime: now + ms('10m'),
        granularity: '5 minute',
        maxNumGroups: 20,
        seriesReturnType: clickhouse.SeriesReturnType.Column,
      })
    ).data;

    const oldData = clickhouse.getLogsChart({
      aggFn: clickhouse.AggFn.Sum,
      field: 'awesomeNumber',
      q: `runId:${runId}`,
      groupBy: 'testGroup',
      tableVersion: undefined,
      teamId,
      startTime: now,
      endTime: now + ms('10m'),
      granularity: '5 minute',
      maxNumGroups: 20,
      propertyTypeMappingsModel,
    });

    expect(data.length).toEqual(3);
    expect(data).toMatchInlineSnapshot(`
Array [
  Object {
    "data": 777,
    "group": Array [
      "group2",
    ],
    "ts_bucket": 1641340800,
  },
  Object {
    "data": 77,
    "group": Array [
      "group1",
    ],
    "ts_bucket": 1641340800,
  },
  Object {
    "data": 7,
    "group": Array [
      "group1",
    ],
    "ts_bucket": 1641341100,
  },
]
`);

    expect(data).toMatchObject(oldData);
  });

  it('clientInsertWithRetries (success)', async () => {
    jest
      .spyOn(clickhouse.client, 'insert')
      .mockRejectedValueOnce(new Error('first error'))
      .mockRejectedValueOnce(new Error('second error'))
      .mockResolvedValueOnce(null as any);

    await clickhouse.clientInsertWithRetries({
      table: 'testTable',
      values: [{ test: 'test' }],
      retries: 3,
      timeout: 100,
    });

    expect(clickhouse.client.insert).toHaveBeenCalledTimes(3);
  });

  it('clientInsertWithRetries (fail)', async () => {
    jest
      .spyOn(clickhouse.client, 'insert')
      .mockRejectedValueOnce(new Error('first error'))
      .mockRejectedValueOnce(new Error('second error'));

    try {
      await clickhouse.clientInsertWithRetries({
        table: 'testTable',
        values: [{ test: 'test' }],
        retries: 2,
        timeout: 100,
      });
    } catch (error: any) {
      expect(error.message).toBe('second error');
    }

    expect(clickhouse.client.insert).toHaveBeenCalledTimes(2);
    expect.assertions(2);
  });

  // TODO: Test this with real data and new chart fn
  it.skip('getMetricsChart avoids sending NaN to frontend', async () => {
    jest
      .spyOn(clickhouse.client, 'query')
      .mockResolvedValueOnce({ json: () => Promise.resolve({}) } as any);

    await clickhouse.getMetricsChart({
      aggFn: clickhouse.AggFn.AvgRate,
      dataType: clickhouse.MetricsDataType.Sum,
      endTime: Date.now(),
      granularity: clickhouse.Granularity.OneHour,
      name: 'test',
      q: '',
      startTime: Date.now() - 1000 * 60 * 60 * 24,
      teamId: 'test',
    });

    expect(clickhouse.client.query).toHaveBeenCalledTimes(2);
    expect(clickhouse.client.query).toHaveBeenCalledWith(
      expect.objectContaining({
        format: 'JSON',
        query: expect.stringContaining('isNaN(rate) = 0'),
      }),
    );
  });
});
