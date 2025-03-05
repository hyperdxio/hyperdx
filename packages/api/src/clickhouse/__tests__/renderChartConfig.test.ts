// TODO: we might want to move this test file to common-utils package

import { ChSql, ClickhouseClient } from '@hyperdx/common-utils/dist/clickhouse';
import { getMetadata } from '@hyperdx/common-utils/dist/metadata';
import { renderChartConfig } from '@hyperdx/common-utils/dist/renderChartConfig';
import _ from 'lodash';
import ms from 'ms';

import { MetricsDataType } from '@/../../common-utils/dist/types';
import * as config from '@/config';
import { createTeam } from '@/controllers/team';
import {
  bulkInsertLogs,
  bulkInsertMetricsGauge,
  bulkInsertMetricsSum,
  DEFAULT_DATABASE,
  DEFAULT_LOGS_TABLE,
  DEFAULT_METRICS_TABLE,
  getServer,
} from '@/fixtures';
import Connection from '@/models/connection';
import { Source } from '@/models/source';

describe('renderChartConfig', () => {
  const server = getServer();

  const now = new Date('2022-01-05').getTime();
  let team, connection, logSource, metricSource, metadata;
  let clickhouseClient: ClickhouseClient;

  const queryData = async (chsql: ChSql) => {
    try {
      const res = await clickhouseClient.query<'JSON'>({
        query: chsql.sql,
        query_params: chsql.params,
        format: 'JSON',
      });
      const json = await res.json();
      return json.data;
    } catch (err) {
      console.error('[ClickhouseClient] Error:', err);
      throw err;
    }
  };

  beforeAll(async () => {
    await server.start();
  });

  afterAll(async () => {
    await server.stop();
  });

  beforeEach(async () => {
    team = await createTeam({ name: 'My Team' });
    connection = await Connection.create({
      team: team._id,
      name: 'Default',
      host: config.CLICKHOUSE_HOST,
      username: config.CLICKHOUSE_USER,
      password: config.CLICKHOUSE_PASSWORD,
    });
    logSource = await Source.create({
      kind: 'log',
      team: team._id,
      from: {
        databaseName: DEFAULT_DATABASE,
        tableName: DEFAULT_LOGS_TABLE,
      },
      timestampValueExpression: 'Timestamp',
      connection: connection.id,
      name: 'Logs',
    });
    metricSource = await Source.create({
      kind: 'metric',
      team: team._id,
      from: {
        databaseName: DEFAULT_DATABASE,
        tableName: '',
      },
      timestampValueExpression: 'TimeUnix',
      connection: connection.id,
      name: 'OTLPMetrics',
    });
    clickhouseClient = new ClickhouseClient({
      host: connection.host,
      username: connection.username,
      password: connection.password,
    });
    metadata = getMetadata(clickhouseClient);
  });

  afterEach(async () => {
    await server.clearDBs();
    jest.clearAllMocks();
  });

  describe('Query Events', () => {
    it('simple select + where query logs', async () => {
      const now = new Date('2023-11-16T22:12:00.000Z');
      await bulkInsertLogs([
        {
          ServiceName: 'api',
          Timestamp: now,
          SeverityText: 'error',
          Body: 'Oh no! Something went wrong!',
        },
        {
          ServiceName: 'api',
          Timestamp: now,
          SeverityText: 'info',
          Body: 'This is a test message.',
        },
      ]);
      const query = await renderChartConfig(
        {
          select: [
            {
              valueExpression: 'Body',
            },
          ],
          from: logSource.from,
          where: `SeverityText = 'error'`,
          timestampValueExpression: 'Timestamp',
          connection: connection.id,
        },
        metadata,
      );

      const resp = await clickhouseClient
        .query<'JSON'>({
          query: query.sql,
          query_params: query.params,
          format: 'JSON',
        })
        .then(res => res.json<any>());
      expect(resp.data).toMatchSnapshot();
    });

    it('simple select + group by query logs', async () => {
      const now = new Date('2023-11-16T22:12:00.000Z');
      await bulkInsertLogs([
        {
          ServiceName: 'api',
          Timestamp: now,
          SeverityText: 'error',
          Body: 'Oh no! Something went wrong!',
        },
        {
          ServiceName: 'app',
          Timestamp: now,
          SeverityText: 'info',
          Body: 'This is a test message.',
        },
      ]);
      const query = await renderChartConfig(
        {
          select: [
            {
              valueExpression: 'ServiceName',
            },
            {
              valueExpression: 'count()',
              alias: 'count',
            },
          ],
          from: logSource.from,
          where: '',
          timestampValueExpression: 'Timestamp',
          connection: connection.id,
          groupBy: 'ServiceName',
        },
        metadata,
      );
      expect(await queryData(query)).toMatchSnapshot();
    });

    // TODO: add more tests (including events chart, using filters, etc)
  });

  describe('Query Metrics', () => {
    beforeEach(async () => {
      const gaugePointsA = [
        { value: 50, timestamp: now },
        { value: 25, timestamp: now + ms('1m') },
        { value: 12.5, timestamp: now + ms('2m') },
        { value: 6.25, timestamp: now + ms('3m') },
        { value: 100, timestamp: now + ms('6m') },
        { value: 75, timestamp: now + ms('7m') },
        { value: 10, timestamp: now + ms('8m') },
        { value: 80, timestamp: now + ms('9m') },
      ].map(point => ({
        MetricName: 'test.cpu',
        ResourceAttributes: {
          host: 'host1',
          ip: '127.0.0.1',
        },
        Value: point.value,
        TimeUnix: new Date(point.timestamp),
      }));
      const gaugePointsB = [
        { value: 1, timestamp: now },
        { value: 2, timestamp: now + ms('1m') },
        { value: 3, timestamp: now + ms('2m') },
        { value: 4, timestamp: now + ms('3m') },
        { value: 5, timestamp: now + ms('6m') },
        { value: 6, timestamp: now + ms('7m') },
        { value: 5, timestamp: now + ms('8m') },
        { value: 4, timestamp: now + ms('9m') },
      ].map(point => ({
        MetricName: 'test.cpu',
        ResourceAttributes: {
          host: 'host2',
          ip: '127.0.2',
        },
        Value: point.value,
        TimeUnix: new Date(point.timestamp),
      }));
      // Rate: 8, 1, 8, 25
      const sumPointsA = [
        { value: 0, timestamp: now - ms('1m') }, // 0
        { value: 1, timestamp: now },
        { value: 8, timestamp: now + ms('4m') }, // 8
        { value: 8, timestamp: now + ms('6m') },
        { value: 9, timestamp: now + ms('9m') }, // 9
        { value: 15, timestamp: now + ms('11m') },
        { value: 17, timestamp: now + ms('14m') }, // 17
        { value: 32, timestamp: now + ms('16m') },
        { value: 42, timestamp: now + ms('19m') }, // 42
      ].map(point => ({
        MetricName: 'test.users',
        ResourceAttributes: {
          host: 'host1',
          ip: '127.0.0.1',
        },
        Value: point.value,
        TimeUnix: new Date(point.timestamp),
        IsMonotonic: true,
        AggregationTemporality: 2, // Cumulative
      }));
      // Rate: 11, 78, 5805, 78729
      // Sum: 12, 79, 5813, 78754
      const sumPointsB = [
        { value: 3, timestamp: now - ms('1m') }, // 3
        { value: 3, timestamp: now },
        { value: 14, timestamp: now + ms('4m') }, // 14
        { value: 15, timestamp: now + ms('6m') },
        { value: 92, timestamp: now + ms('9m') }, // 92
        { value: 653, timestamp: now + ms('11m') },
        { value: 5897, timestamp: now + ms('14m') }, // 5897
        { value: 9323, timestamp: now + ms('16m') },
        { value: 84626, timestamp: now + ms('19m') }, // 84626
      ].map(point => ({
        MetricName: 'test.users',
        ResourceAttributes: {
          host: 'host2',
          ip: '127.0.0.1',
        },
        Value: point.value,
        TimeUnix: new Date(point.timestamp),
        IsMonotonic: true,
        AggregationTemporality: 2, // Cumulative
      }));
      const sumPointsC = [
        { value: 0, timestamp: now - ms('1m') }, // 0
        { value: 1, timestamp: now },
        { value: 8, timestamp: now + ms('1m') }, // 8
        { value: 0, timestamp: now + ms('2m') },
        { value: 7, timestamp: now + ms('2m') },
        { value: 7, timestamp: now + ms('10m') }, // 9
        { value: 15, timestamp: now + ms('12m') },
        { value: 17, timestamp: now + ms('14m') }, // 17
        { value: 0, timestamp: now + ms('16m') },
        { value: 42, timestamp: now + ms('19m') }, // 42
      ].map(point => ({
        MetricName: 'counter.reset',
        ResourceAttributes: {
          host: 'host3',
          ip: '127.0.1',
        },
        Value: point.value,
        TimeUnix: new Date(point.timestamp),
        IsMonotonic: true,
        AggregationTemporality: 2, // Cumulative
      }));
      const sumPointsD = [
        { value: 0, timestamp: now - ms('1m') }, // 0
        { value: 1, timestamp: now },
        { value: 8, timestamp: now + ms('1m') }, // 8
        { value: 0, timestamp: now + ms('2m') },
        { value: 7, timestamp: now + ms('2m') },
        { value: 7, timestamp: now + ms('10m') }, // 9
        { value: 15, timestamp: now + ms('12m') },
        { value: 17, timestamp: now + ms('14m') }, // 17
        { value: 0, timestamp: now + ms('16m') },
        { value: 42, timestamp: now + ms('19m') }, // 42
      ].map(point => ({
        MetricName: 'counter.min_reset',
        ResourceAttributes: {
          host: 'MIN_VARIANT_0',
          ip: '127.0.1',
        },
        Value: point.value,
        TimeUnix: new Date(point.timestamp),
        IsMonotonic: true,
        AggregationTemporality: 2, // Cumulative
      }));
      const sumPointsE = [
        { value: 0, timestamp: now - ms('1m') },
        { value: 2, timestamp: now },
        { value: 9, timestamp: now + ms('1m') },
        { value: 0, timestamp: now + ms('2m') },
        { value: 15, timestamp: now + ms('2m') },
        { value: 25, timestamp: now + ms('10m') },
        { value: 35, timestamp: now + ms('12m') },
        { value: 57, timestamp: now + ms('14m') },
        { value: 0, timestamp: now + ms('16m') },
        { value: 92, timestamp: now + ms('19m') },
      ].map(point => ({
        MetricName: 'counter.min_reset',
        ResourceAttributes: {
          host: 'MAX_VARIANT_1',
          ip: '127.0.1',
        },
        Value: point.value,
        TimeUnix: new Date(point.timestamp),
        IsMonotonic: true,
        AggregationTemporality: 2, // Cumulative
      }));

      await Promise.all([
        bulkInsertMetricsGauge([...gaugePointsA, ...gaugePointsB]),
        bulkInsertMetricsSum([
          ...sumPointsA,
          ...sumPointsB,
          ...sumPointsC,
          ...sumPointsD,
          ...sumPointsE,
        ]),
      ]);
    });

    it.skip('gauge (last value)', async () => {
      // IMPLEMENT ME (last_value aggregation)
    });

    it('single sum gauge', async () => {
      const query = await renderChartConfig(
        {
          select: [
            {
              aggFn: 'sum',
              metricName: 'test.cpu',
              metricType: MetricsDataType.Gauge,
              valueExpression: 'Value',
            },
          ],
          from: metricSource.from,
          where: '',
          metricTables: {
            sum: DEFAULT_METRICS_TABLE.SUM,
            gauge: DEFAULT_METRICS_TABLE.GAUGE,
            histogram: DEFAULT_METRICS_TABLE.HISTOGRAM,
          },
          dateRange: [new Date(now), new Date(now + ms('10m'))],
          granularity: '5 minute',
          timestampValueExpression: metricSource.timestampValueExpression,
          connection: connection.id,
        },
        metadata,
      );
      expect(await queryData(query)).toMatchSnapshot();
    });

    it('single avg gauge', async () => {
      const query = await renderChartConfig(
        {
          select: [
            {
              aggFn: 'avg',
              metricName: 'test.cpu',
              metricType: MetricsDataType.Gauge,
              valueExpression: 'Value',
            },
          ],
          from: metricSource.from,
          where: '',
          metricTables: {
            sum: DEFAULT_METRICS_TABLE.SUM,
            gauge: DEFAULT_METRICS_TABLE.GAUGE,
            histogram: DEFAULT_METRICS_TABLE.HISTOGRAM,
          },
          dateRange: [new Date(now), new Date(now + ms('10m'))],
          granularity: '5 minute',
          timestampValueExpression: metricSource.timestampValueExpression,
          connection: connection.id,
        },
        metadata,
      );
      expect(await queryData(query)).toMatchSnapshot();
    });

    it('single avg gauge with group-by', async () => {
      const query = await renderChartConfig(
        {
          select: [
            {
              aggFn: 'avg',
              metricName: 'test.cpu',
              metricType: MetricsDataType.Gauge,
              valueExpression: 'Value',
            },
          ],
          from: metricSource.from,
          where: '',
          metricTables: {
            sum: DEFAULT_METRICS_TABLE.SUM,
            gauge: DEFAULT_METRICS_TABLE.GAUGE,
            histogram: DEFAULT_METRICS_TABLE.HISTOGRAM,
          },
          dateRange: [new Date(now), new Date(now + ms('10m'))],
          granularity: '5 minute',
          groupBy: `ResourceAttributes['host']`,
          timestampValueExpression: metricSource.timestampValueExpression,
          connection: connection.id,
        },
        metadata,
      );
      expect(await queryData(query)).toMatchSnapshot();
    });

    it('single sum rate', async () => {
      const query = await renderChartConfig(
        {
          select: [
            {
              aggFn: 'sum',
              metricName: 'test.users',
              metricType: MetricsDataType.Sum,
              valueExpression: 'Value',
            },
          ],
          from: metricSource.from,
          where: '',
          metricTables: {
            sum: DEFAULT_METRICS_TABLE.SUM,
            gauge: DEFAULT_METRICS_TABLE.GAUGE,
            histogram: DEFAULT_METRICS_TABLE.HISTOGRAM,
          },
          dateRange: [new Date(now), new Date(now + ms('20m'))],
          granularity: '5 minute',
          timestampValueExpression: metricSource.timestampValueExpression,
          connection: connection.id,
        },
        metadata,
      );
      expect(await queryData(query)).toMatchSnapshot();
    });

    it('handles counter resets correctly for sum metrics', async () => {
      const query = await renderChartConfig(
        {
          select: [
            {
              aggFn: 'sum',
              metricName: 'counter.reset',
              metricType: MetricsDataType.Sum,
              valueExpression: 'Value',
            },
          ],
          from: metricSource.from,
          where: '',
          metricTables: {
            sum: DEFAULT_METRICS_TABLE.SUM,
            gauge: DEFAULT_METRICS_TABLE.GAUGE,
            histogram: DEFAULT_METRICS_TABLE.HISTOGRAM,
          },
          dateRange: [new Date(now), new Date(now + ms('20m'))],
          granularity: '10 minute',
          timestampValueExpression: metricSource.timestampValueExpression,
          connection: connection.id,
        },
        metadata,
      );
      expect(await queryData(query)).toMatchSnapshot();
    });

    // FIXME: here are the expected values
    // [0, 1, 8, 8, 15, 15, 23, 25, 25, 67]
    // [0, 2, 9, 9, 24, 34, 44, 66, 66, 158]
    // min -> [15, 52]
    // max -> [24, 134]
    it.skip('calculates min_rate/max_rate correctly for sum metrics', async () => {
      const minQuery = await renderChartConfig(
        {
          select: [
            {
              aggFn: 'min',
              metricName: 'counter.min_reset',
              metricType: MetricsDataType.Sum,
              valueExpression: 'Value',
            },
          ],
          from: metricSource.from,
          where: '',
          metricTables: {
            sum: DEFAULT_METRICS_TABLE.SUM,
            gauge: DEFAULT_METRICS_TABLE.GAUGE,
            histogram: DEFAULT_METRICS_TABLE.HISTOGRAM,
          },
          dateRange: [new Date(now), new Date(now + ms('20m'))],
          granularity: '10 minute',
          timestampValueExpression: metricSource.timestampValueExpression,
          connection: connection.id,
        },
        metadata,
      );

      const maxQuery = await renderChartConfig(
        {
          select: [
            {
              aggFn: 'max',
              metricName: 'counter.min_reset',
              metricType: MetricsDataType.Sum,
              valueExpression: 'Value',
            },
          ],
          from: metricSource.from,
          where: '',
          metricTables: {
            sum: DEFAULT_METRICS_TABLE.SUM,
            gauge: DEFAULT_METRICS_TABLE.GAUGE,
            histogram: DEFAULT_METRICS_TABLE.HISTOGRAM,
          },
          dateRange: [new Date(now), new Date(now + ms('20m'))],
          granularity: '10 minute',
          timestampValueExpression: metricSource.timestampValueExpression,
          connection: connection.id,
        },
        metadata,
      );
    });
  });
});
