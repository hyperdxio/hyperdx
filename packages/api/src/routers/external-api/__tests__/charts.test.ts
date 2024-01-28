import _ from 'lodash';
import ms from 'ms';

import * as clickhouse from '@/clickhouse';
import {
  clearDBCollections,
  generateBuildTeamEventFn,
  getLoggedInAgent,
  getServer,
  mockLogsPropertyTypeMappingsModel,
} from '@/fixtures';

describe('/api/v1/charts/series', () => {
  const server = getServer();

  beforeAll(async () => {
    await server.start();
  });

  afterEach(async () => {
    await clearDBCollections();
  });

  afterAll(async () => {
    await server.stop();
  });

  const now = new Date('2022-01-05').getTime();

  it('queries multi-series time charts', async () => {
    const { agent, user } = await getLoggedInAgent(server);

    const runId = Math.random().toString(); // dedup watch mode runs
    const teamId = `test`;

    const buildEvent = generateBuildTeamEventFn(teamId, {});

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

    const results = await agent
      .post('/api/v1/charts/series')
      .set('Authorization', `Bearer ${user?.accessKey}`)
      .send({
        series: [
          {
            dataSource: 'events',
            aggFn: 'sum',
            field: 'hyperdx_event_size',
            where: `runId: ${runId}`,
            groupBy: ['service'],
          },
          {
            dataSource: 'events',
            aggFn: 'count',
            field: '',
            where: `runId: ${runId}`,
            groupBy: ['service'],
          },
        ],
        endTime: now + ms('10m'),
        startTime: now,
        seriesReturnType: 'column',
      })
      .expect(200);

    expect(results.body.data).toMatchInlineSnapshot(`
Array [
  Object {
    "group": Array [
      "test-service",
    ],
    "series_0.data": 36,
    "series_1.data": 9,
    "ts_bucket": 0,
  },
]
`);
  });

  it('validates all group bys are the same value', async () => {
    const { agent, user } = await getLoggedInAgent(server);

    await agent
      .post('/api/v1/charts/series')
      .set('Authorization', `Bearer ${user?.accessKey}`)
      .send({
        series: [
          {
            dataSource: 'events',
            aggFn: 'sum',
            field: 'hyperdx_event_size',
            where: '',
            groupBy: ['service'],
            numberFormat: {
              output: 'byte',
            },
          },
          {
            dataSource: 'events',
            aggFn: 'count',
            field: '',
            where: '',
            groupBy: ['level'],
          },
        ],
        endTime: now + ms('10m'),
        startTime: now,
        seriesReturnType: 'column',
      })
      .expect(400);

    await agent
      .post('/api/v1/charts/series')
      .set('Authorization', `Bearer ${user?.accessKey}`)
      .send({
        series: [
          {
            dataSource: 'events',
            aggFn: 'sum',
            field: 'hyperdx_event_size',
            where: '',
            groupBy: ['level'],
            numberFormat: {
              output: 'byte',
            },
          },
          {
            dataSource: 'events',
            aggFn: 'count',
            field: '',
            where: '',
            groupBy: ['level'],
          },
        ],
        endTime: now + ms('10m'),
        startTime: now,
        seriesReturnType: 'column',
      })
      .expect(200);
  });

  it('rejects excess series queries', async () => {
    const series = {
      dataSource: 'events',
      aggFn: 'sum',
      field: 'hyperdx_event_size',
      where: '',
      groupBy: ['service'],
      numberFormat: {
        output: 'byte',
      },
    };

    const { agent, user } = await getLoggedInAgent(server);

    await agent
      .post('/api/v1/charts/series')
      .set('Authorization', `Bearer ${user?.accessKey}`)
      .send({
        series: [series, series, series, series, series, series, series],
        endTime: now + ms('10m'),
        startTime: now,
        seriesReturnType: 'column',
      })
      .expect(400);
  });
});
