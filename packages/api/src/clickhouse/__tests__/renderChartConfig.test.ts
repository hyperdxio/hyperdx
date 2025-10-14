// TODO: we might want to move this test file to common-utils package

import { ChSql } from '@hyperdx/common-utils/dist/clickhouse';
import { ClickhouseClient } from '@hyperdx/common-utils/dist/clickhouse/node';
import { getMetadata } from '@hyperdx/common-utils/dist/metadata';
import { renderChartConfig } from '@hyperdx/common-utils/dist/renderChartConfig';
import {
  AggregateFunctionSchema,
  DerivedColumn,
  MetricsDataType,
} from '@hyperdx/common-utils/dist/types';
import _ from 'lodash';
import ms from 'ms';

import * as config from '@/config';
import { createTeam } from '@/controllers/team';
import {
  bulkInsertLogs,
  bulkInsertMetricsGauge,
  bulkInsertMetricsHistogram,
  bulkInsertMetricsSum,
  DEFAULT_DATABASE,
  DEFAULT_LOGS_TABLE,
  DEFAULT_METRICS_TABLE,
  executeSqlCommand,
  getServer,
} from '@/fixtures';
import Connection from '@/models/connection';
import { Source } from '@/models/source';

const TEST_METRIC_TABLES = {
  sum: DEFAULT_METRICS_TABLE.SUM,
  gauge: DEFAULT_METRICS_TABLE.GAUGE,
  histogram: DEFAULT_METRICS_TABLE.HISTOGRAM,
  summary: DEFAULT_METRICS_TABLE.SUMMARY,
  'exponential histogram': DEFAULT_METRICS_TABLE.EXPONENTIAL_HISTOGRAM,
};

describe('renderChartConfig', () => {
  const server = getServer();

  const now = new Date('2022-01-05').getTime();
  let team, connection, logSource, metricSource, metadata;
  let clickhouseClient: ClickhouseClient;

  const nowPlus = time_val => new Date(now + ms(time_val));

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
    console.log('running db cleanup code');
    await server.clearDBs();
    jest.clearAllMocks();
  });

  describe('aggFn', () => {
    afterAll(async () => {
      await executeSqlCommand('DROP TABLE IF EXISTS agg_fn_str_test');
      await executeSqlCommand('DROP TABLE IF EXISTS agg_fn_default_test');
    });

    it('numeric agg functions should handle numeric values as strings', async () => {
      await executeSqlCommand(`
        CREATE TABLE agg_fn_str_test(
          ts UInt64,
          strVal String
        ) ENGINE = MergeTree
          ORDER BY ts
      `);
      await executeSqlCommand(`
        INSERT INTO agg_fn_str_test(ts, strVal) VALUES
          (fromUnixTimestamp64Milli(1519211811570), '3'),
          (fromUnixTimestamp64Milli(1519211811770), '-1'),
          (fromUnixTimestamp64Milli(1519211811870), '1.1'),
          (fromUnixTimestamp64Milli(1519211811970), '-1.1'),
      `);

      const query = await renderChartConfig(
        {
          select: [
            { aggFn: 'avg', valueExpression: 'strVal' },
            { aggFn: 'max', valueExpression: 'strVal' },
            { aggFn: 'min', valueExpression: 'strVal' },
            { aggFn: 'quantile', level: 0.5, valueExpression: 'strVal' },
            { aggFn: 'sum', valueExpression: 'strVal' },
          ],
          from: {
            databaseName: '',
            tableName: `agg_fn_str_test`,
          },
          where: '',
          connection: connection.id,
          timestampValueExpression: 'ts',
        },
        metadata,
      );
      const res = await queryData(query);
      expect(res).toMatchSnapshot();
    });

    it('numeric agg functions should use default values for other types', async () => {
      await executeSqlCommand(`
        CREATE TABLE agg_fn_default_test(
          ts UInt64,
          strVal String,
          boolVal Bool,
          enumVal Enum('a' = 1, 'b' = 2),
          nullVal Nullable(String),
        ) ENGINE = MergeTree
          ORDER BY ts
      `);
      await executeSqlCommand(`
        INSERT INTO agg_fn_default_test(ts, strVal, boolVal, enumVal, nullVal) VALUES
          (fromUnixTimestamp64Milli(1519211811570), 'a', false, 'b', NULL)
      `);
      const query = await renderChartConfig(
        {
          select: [
            { aggFn: 'avg', valueExpression: 'strVal' },
            { aggFn: 'max', valueExpression: 'strVal' },
            { aggFn: 'min', valueExpression: 'strVal' },
            { aggFn: 'quantile', level: 0.5, valueExpression: 'strVal' },
            { aggFn: 'sum', valueExpression: 'strVal' },
          ],
          from: {
            databaseName: '',
            tableName: `agg_fn_default_test`,
          },
          where: '',
          connection: connection.id,
          timestampValueExpression: 'ts',
        },
        metadata,
      );
      const res = await queryData(query);
      expect(res).toMatchSnapshot();
    });
  });

  describe('Query Events - Logs', () => {
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
        .then(res => res.json() as any);
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

  describe('Query Metrics - Gauge', () => {
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
        ServiceName: 'db',
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
        ServiceName: 'db',
        ResourceAttributes: {
          host: 'host2',
          ip: '127.0.2',
        },
        Value: point.value,
        TimeUnix: new Date(point.timestamp),
      }));
      await bulkInsertMetricsGauge([...gaugePointsA, ...gaugePointsB]);
    });

    it('single max/avg/sum gauge', async () => {
      const avgQuery = await renderChartConfig(
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
          metricTables: TEST_METRIC_TABLES,
          dateRange: [new Date(now), new Date(now + ms('10m'))],
          granularity: '5 minute',
          timestampValueExpression: metricSource.timestampValueExpression,
          connection: connection.id,
        },
        metadata,
      );
      expect(await queryData(avgQuery)).toMatchSnapshot();
      const maxQuery = await renderChartConfig(
        {
          select: [
            {
              aggFn: 'max',
              metricName: 'test.cpu',
              metricType: MetricsDataType.Gauge,
              valueExpression: 'Value',
            },
          ],
          from: metricSource.from,
          where: '',
          metricTables: TEST_METRIC_TABLES,
          dateRange: [new Date(now), new Date(now + ms('10m'))],
          granularity: '5 minute',
          timestampValueExpression: metricSource.timestampValueExpression,
          connection: connection.id,
        },
        metadata,
      );
      expect(await queryData(maxQuery)).toMatchSnapshot();
      const sumQuery = await renderChartConfig(
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
          metricTables: TEST_METRIC_TABLES,
          dateRange: [new Date(now), new Date(now + ms('10m'))],
          granularity: '5 minute',
          timestampValueExpression: metricSource.timestampValueExpression,
          connection: connection.id,
        },
        metadata,
      );
      expect(await queryData(sumQuery)).toMatchSnapshot();
    });

    it('single avg gauge with where', async () => {
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
          where: 'ServiceName:"db" AND ResourceAttributes.host:"host1"',
          whereLanguage: 'lucene',
          metricTables: TEST_METRIC_TABLES,
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
          metricTables: TEST_METRIC_TABLES,
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

    it('single max gauge with delta', async () => {
      const query = await renderChartConfig(
        {
          select: [
            {
              aggFn: 'max',
              metricName: 'test.cpu',
              metricType: MetricsDataType.Gauge,
              valueExpression: 'Value',
              isDelta: true,
            },
          ],
          from: metricSource.from,
          where: '',
          metricTables: TEST_METRIC_TABLES,
          dateRange: [new Date(now), new Date(now + ms('10m'))],
          granularity: '5 minute',
          timestampValueExpression: metricSource.timestampValueExpression,
          connection: connection.id,
        },
        metadata,
      );
      expect(await queryData(query)).toMatchSnapshot();
    });

    it('single max gauge with delta and group by', async () => {
      const query = await renderChartConfig(
        {
          select: [
            {
              aggFn: 'max',
              metricName: 'test.cpu',
              metricType: MetricsDataType.Gauge,
              valueExpression: 'Value',
              isDelta: true,
            },
          ],
          from: metricSource.from,
          where: '',
          metricTables: TEST_METRIC_TABLES,
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
  });

  describe('Query Metrics - Sum', () => {
    beforeEach(async () => {
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
        ServiceName: 'api',
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
        ServiceName: 'api',
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
        ServiceName: 'api',
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
        ServiceName: 'api',
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
        ServiceName: 'api',
        ResourceAttributes: {
          host: 'MAX_VARIANT_1',
          ip: '127.0.1',
        },
        Value: point.value,
        TimeUnix: new Date(point.timestamp),
        IsMonotonic: true,
        AggregationTemporality: 2, // Cumulative
      }));
      const podAgePoints = [
        { Value: 518400, TimeUnix: new Date(now - ms('1m')) },
        { Value: 604800, TimeUnix: new Date(now) },
        { Value: 691200, TimeUnix: new Date(now + ms('1m')) },
        { Value: 777600, TimeUnix: new Date(now + ms('2m')) },
        { Value: 864000, TimeUnix: new Date(now + ms('3m')) },
        { Value: 950400, TimeUnix: new Date(now + ms('4m')) },
        { Value: 1641600, TimeUnix: new Date(now + ms('12m')) },
      ].map(point => ({
        MetricName: 'k8s.pod.uptime',
        ServiceName: 'api',
        ResourceAttributes: {
          host: 'cluster-node-1',
          ip: '127.0.0.1',
        },
        IsMonotonic: true,
        AggregationTemporality: 2,
        ...point,
      }));
      await bulkInsertMetricsSum([
        ...sumPointsA,
        ...sumPointsB,
        ...sumPointsC,
        ...sumPointsD,
        ...sumPointsE,
        ...podAgePoints,
      ]);
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
          metricTables: TEST_METRIC_TABLES,
          dateRange: [new Date(now), new Date(now + ms('20m'))],
          granularity: '5 minute',
          timestampValueExpression: metricSource.timestampValueExpression,
          connection: connection.id,
        },
        metadata,
      );
      expect(await queryData(query)).toMatchSnapshot();
    });

    it('sum values as without rate computation', async () => {
      const query = await renderChartConfig(
        {
          select: [
            {
              metricName: 'k8s.pod.uptime',
              metricType: MetricsDataType.Sum,
              valueExpression: 'Value',
            },
          ],
          from: metricSource.from,
          where: 'ServiceName:api',
          whereLanguage: 'lucene',
          metricTables: TEST_METRIC_TABLES,
          dateRange: [new Date(now), new Date(now + ms('20m'))],
          granularity: '5 minutes',
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
          metricTables: TEST_METRIC_TABLES,
          dateRange: [new Date(now), new Date(now + ms('20m'))],
          granularity: '10 minute',
          timestampValueExpression: metricSource.timestampValueExpression,
          connection: connection.id,
        },
        metadata,
      );
      expect(await queryData(query)).toMatchSnapshot();
    });

    it('calculates min_rate/max_rate correctly for sum metrics', async () => {
      // Raw Data is
      // MIN_VARIANT_0: [0, 1, 8, 0, 7, 7, 15, 17, 0, 42]
      // MIN_VARIANT_1: [0, 2, 9, 0, 15, 25 35, 57, 0, 92]
      //
      // Based on the data inserted in the fixture, the expected stream of values
      // for each series after adjusting for the zero reset should be:
      // MIN_VARIANT_0: [0, 1, 8, 8, 15, 15, 23, 25, 25, 67]
      // MIN_VARIANT_1: [0, 2, 9, 9, 24, 34, 44, 66, 66, 158]
      //
      // At the 10 minute buckets, should result in three buckets for each where
      // the first bucket is outside the query window.
      // MIN_VARIANT_0: [0], [1, 8, 8, 15], [15, 23, 25, 25, 67]]
      // MIN_VARIANT_1: [0], [2, 9, 9, 24], [34, 44, 66, 66, 158]]
      //
      // When comparing the value at the end of the buckets over the filtered
      // time frame it should result in the following counts added per bucket as:
      // MIN_VARIANT_0: [15, 52]
      // MIN_VARIANT_1: [24, 134]
      //
      // These values are what we apply the aggregation functions to.
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
          metricTables: TEST_METRIC_TABLES,
          dateRange: [new Date(now), new Date(now + ms('20m'))],
          granularity: '10 minute',
          timestampValueExpression: metricSource.timestampValueExpression,
          connection: connection.id,
        },
        metadata,
      );
      expect(await queryData(minQuery)).toMatchSnapshot('minSum');

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
          metricTables: TEST_METRIC_TABLES,
          dateRange: [new Date(now), new Date(now + ms('20m'))],
          granularity: '10 minute',
          timestampValueExpression: metricSource.timestampValueExpression,
          connection: connection.id,
        },
        metadata,
      );
      expect(await queryData(maxQuery)).toMatchSnapshot('maxSum');
    });
  });

  describe('Query Metrics - Histogram', () => {
    beforeEach(async () => {
      const histPointsA = [
        {
          BucketCounts: [0, 0, 0],
          TimeUnix: new Date(now),
        },
        {
          BucketCounts: [10, 10, 10],
          TimeUnix: new Date(now + ms('1m')),
        },
      ].map(point => ({
        MetricName: 'test.two_timestamps_lower_bound',
        ResourceAttributes: {
          host: 'test2',
          ip: '127.0.0.1',
        },
        AggregationTemporality: 2, // Cumulative
        ExplicitBounds: [10, 30],
        ...point,
      }));
      const histPointsB = [
        {
          BucketCounts: [0, 0, 0],
          TimeUnix: new Date(now),
        },
        {
          BucketCounts: [10, 0, 0],
          TimeUnix: new Date(now + ms('1m')),
        },
      ].map(point => ({
        MetricName: 'test.two_timestamps_lower_bound_inf',
        ResourceAttributes: {
          host: 'test2',
          ip: '127.0.0.1',
        },
        AggregationTemporality: 2, // Cumulative
        ExplicitBounds: [1, 30],
        ...point,
      }));
      const histPointsC = [
        {
          BucketCounts: [0, 0, 0],
          TimeUnix: new Date(now),
        },
        {
          BucketCounts: [0, 0, 10],
          TimeUnix: new Date(now + ms('1m')),
        },
      ].map(point => ({
        MetricName: 'test.two_timestamps_upper_bound_inf',
        ResourceAttributes: {
          host: 'test2',
          ip: '127.0.0.1',
        },
        AggregationTemporality: 2, // Cumulative
        ExplicitBounds: [0, 30],
        ...point,
      }));
      const histPointsD = [
        {
          BucketCounts: [5, 5, 5],
          TimeUnix: new Date(now),
        },
        {
          BucketCounts: [0, 0, 0],
          TimeUnix: new Date(now + ms('1m')),
        },
        {
          BucketCounts: [10, 10, 10],
          TimeUnix: new Date(now + ms('2m')),
        },
      ].map(point => ({
        MetricName: 'test.three_timestamps_bounded',
        ResourceAttributes: {
          host: 'test3',
          ip: '127.0.0.1',
        },
        AggregationTemporality: 2, // Cumulative
        ExplicitBounds: [10, 30],
        ...point,
      }));
      const histPointsE = [
        {
          BucketCounts: [1, 1, 1, 1, 1, 1],
          TimeUnix: new Date(now),
          ResourceAttributes: { host: 'test-a' },
        },
        {
          BucketCounts: [2, 2, 2, 2, 2, 2],
          TimeUnix: new Date(now + ms('5s')),
          ResourceAttributes: { host: 'test-b' },
        },
        {
          BucketCounts: [2, 1, 2, 1, 2, 1],
          TimeUnix: new Date(now + ms('1m')),
          ResourceAttributes: { host: 'test-a' },
        },
        {
          BucketCounts: [3, 3, 2, 2, 3, 3],
          TimeUnix: new Date(now + ms('65s')),
          ResourceAttributes: { host: 'test-b' },
        },
      ].map(point => ({
        MetricName: 'test.multiple_series',
        AggregationTemporality: 2, // Cumulative
        ExplicitBounds: [1, 2, 5, 8, 13],
        ...point,
      }));
      const histPointsF = [
        {
          TimeUnix: new Date(now),
          ResourceAttributes: { host: 'host-a', service: 'service-1' },
          BucketCounts: [5, 2, 0, 0, 0, 0],
          Count: 7,
          Sum: 18,
        },
        {
          TimeUnix: new Date(now),
          ResourceAttributes: { host: 'host-a', service: 'service-2' },
          BucketCounts: [11, 0, 0, 0, 0, 0],
          Count: 11,
          Sum: 22,
        },
        {
          TimeUnix: new Date(now),
          ResourceAttributes: { host: 'host-a', service: 'service-3' },
          BucketCounts: [0, 5, 0, 0, 0, 0],
          Count: 5,
          Sum: 31,
        },
        {
          TimeUnix: new Date(now),
          ResourceAttributes: { host: 'host-b', service: 'service-1' },
          BucketCounts: [6, 3, 0, 0, 0, 0],
          Count: 9,
          Sum: 37,
        },
        {
          TimeUnix: new Date(now),
          ResourceAttributes: { host: 'host-b', service: 'service-2' },
          BucketCounts: [1, 0, 0, 0, 0, 0],
          Count: 1,
          Sum: 3,
        },
        {
          TimeUnix: new Date(now),
          ResourceAttributes: { host: 'host-b', service: 'service-3' },
          BucketCounts: [4, 2, 0, 0, 0, 0],
          Count: 6,
          Sum: 25,
        },
        //----------
        {
          TimeUnix: nowPlus('30s'),
          ResourceAttributes: { host: 'host-a', service: 'service-1' },
          BucketCounts: [9, 3, 1, 0, 0, 0],
          Count: 13,
          Sum: 54,
        },
        {
          TimeUnix: nowPlus('34s'),
          ResourceAttributes: { host: 'host-a', service: 'service-2' },
          BucketCounts: [17, 2, 0, 0, 0, 0],
          Count: 19,
          Sum: 52,
        },
        {
          TimeUnix: nowPlus('38s'),
          ResourceAttributes: { host: 'host-a', service: 'service-3' },
          BucketCounts: [1, 7, 0, 0, 0, 0],
          Count: 8,
          Sum: 51,
        },
        {
          TimeUnix: nowPlus('29s'),
          ResourceAttributes: { host: 'host-b', service: 'service-1' },
          BucketCounts: [12, 3, 0, 0, 0, 0],
          Count: 15,
          Sum: 52,
        },
        {
          TimeUnix: nowPlus('31s'),
          ResourceAttributes: { host: 'host-b', service: 'service-2' },
          BucketCounts: [9, 1, 0, 0, 0, 0],
          Count: 10,
          Sum: 52,
        },
        {
          TimeUnix: nowPlus('45s'),
          ResourceAttributes: { host: 'host-b', service: 'service-3' },
          BucketCounts: [4, 6, 0, 0, 0, 0],
          Count: 10,
          Sum: 61,
        },
        //----------
        {
          TimeUnix: nowPlus('90s'),
          ResourceAttributes: { host: 'host-a', service: 'service-1' },
          BucketCounts: [9, 6, 6, 4, 2, 0],
          Count: 27,
          Sum: 1015,
        },
        {
          TimeUnix: nowPlus('94s'),
          ResourceAttributes: { host: 'host-a', service: 'service-2' },
          BucketCounts: [17, 4, 5, 7, 0, 0],
          Count: 33,
          Sum: 655,
        },
        {
          TimeUnix: nowPlus('98s'),
          ResourceAttributes: { host: 'host-a', service: 'service-3' },
          BucketCounts: [1, 7, 0, 3, 2, 4],
          Count: 17,
          Sum: 3741,
        },
        {
          TimeUnix: nowPlus('89s'),
          ResourceAttributes: { host: 'host-b', service: 'service-1' },
          BucketCounts: [19, 5, 0, 0, 0, 0],
          Count: 24,
          Sum: 85,
        },
        {
          TimeUnix: nowPlus('91s'),
          ResourceAttributes: { host: 'host-b', service: 'service-2' },
          BucketCounts: [12, 1, 1, 0, 0, 0],
          Count: 14,
          Sum: 109,
        },
        {
          TimeUnix: nowPlus('105s'),
          ResourceAttributes: { host: 'host-b', service: 'service-3' },
          BucketCounts: [4, 8, 0, 0, 0, 0],
          Count: 12,
          Sum: 79,
        },
        //----------
        {
          TimeUnix: nowPlus('150s'),
          ResourceAttributes: { host: 'host-a', service: 'service-1' },
          BucketCounts: [9, 9, 11, 8, 4, 0],
          Count: 41,
          Sum: 1955,
        },
        {
          TimeUnix: nowPlus('154s'),
          ResourceAttributes: { host: 'host-a', service: 'service-2' },
          BucketCounts: [17, 6, 10, 14, 0, 0],
          Count: 47,
          Sum: 1292,
        },
        {
          TimeUnix: nowPlus('158s'),
          ResourceAttributes: { host: 'host-a', service: 'service-3' },
          BucketCounts: [1, 7, 0, 3, 2, 18],
          Count: 31,
          Sum: 22459,
        },
        {
          TimeUnix: nowPlus('149s'),
          ResourceAttributes: { host: 'host-b', service: 'service-1' },
          BucketCounts: [26, 7, 0, 0, 0, 0],
          Count: 33,
          Sum: 120,
        },
        {
          TimeUnix: nowPlus('151s'),
          ResourceAttributes: { host: 'host-b', service: 'service-2' },
          BucketCounts: [15, 1, 2, 0, 0, 0],
          Count: 18,
          Sum: 155,
        },
        {
          TimeUnix: nowPlus('165s'),
          ResourceAttributes: { host: 'host-b', service: 'service-3' },
          BucketCounts: [4, 10, 0, 0, 0, 0],
          Count: 14,
          Sum: 95,
        },
        //----------
        {
          TimeUnix: nowPlus('210s'),
          ResourceAttributes: { host: 'host-a', service: 'service-1' },
          BucketCounts: [19, 12, 11, 8, 4, 0],
          Count: 54,
          Sum: 2003,
        },
        {
          TimeUnix: nowPlus('214s'),
          ResourceAttributes: { host: 'host-a', service: 'service-2' },
          BucketCounts: [37, 10, 10, 14, 0, 0],
          Count: 71,
          Sum: 1337,
        },
        {
          TimeUnix: nowPlus('218s'),
          ResourceAttributes: { host: 'host-a', service: 'service-3' },
          BucketCounts: [20, 0, 0, 0, 0, 0],
          Count: 20,
          Sum: 29,
        },
        {
          TimeUnix: nowPlus('209s'),
          ResourceAttributes: { host: 'host-b', service: 'service-1' },
          BucketCounts: [30, 9, 0, 0, 0, 0],
          Count: 39,
          Sum: 139,
        },
        {
          TimeUnix: nowPlus('211s'),
          ResourceAttributes: { host: 'host-b', service: 'service-2' },
          BucketCounts: [21, 4, 3, 0, 0, 0],
          Count: 28,
          Sum: 223,
        },
        {
          TimeUnix: nowPlus('225s'),
          ResourceAttributes: { host: 'host-b', service: 'service-3' },
          BucketCounts: [14, 11, 0, 0, 0, 0],
          Count: 25,
          Sum: 121,
        },
      ].map(point => ({
        MetricName: 'test.send_latency',
        AggregationTemporality: 2,
        ExplicitBounds: [5, 10, 50, 100, 500],
        ...point,
      }));

      await bulkInsertMetricsHistogram([
        ...histPointsA,
        ...histPointsB,
        ...histPointsC,
        ...histPointsD,
        ...histPointsE,
        ...histPointsF,
      ]);
    });

    it('two_timestamps_bounded histogram (p50)', async () => {
      /*
        This test starts with 2 data points with bounds of [10, 30]:
          t0: [0, 0, 0]
          t1: [10, 10, 10]

        Since the AggregationTemporality is 2(cumulative), we need to calculate the delta between the two points:
          delta: [10, 10, 10] - [0, 0, 0] = [10, 10, 10]

        We need to interpolate between the lower and upper bounds of the second bucket:
          cum sum = [10, 20, 30]
          rank = 0.5 * 30 = 15 (between bounds 10 - 30)
          interpolate: 10 + (30 - 10) * ((15 - 10) / (20 - 10)) = 20
       */
      const query = await renderChartConfig(
        {
          select: [
            {
              aggFn: 'quantile',
              level: 0.5,
              metricName: 'test.two_timestamps_lower_bound',
              metricType: MetricsDataType.Histogram,
              valueExpression: 'Value',
            },
          ],
          from: metricSource.from,
          where: '',
          metricTables: TEST_METRIC_TABLES,
          dateRange: [new Date(now), new Date(now + ms('2m'))],
          granularity: '1 minute',
          timestampValueExpression: metricSource.timestampValueExpression,
          connection: connection.id,
        },
        metadata,
      );
      const res = await queryData(query);
      expect(res).toMatchSnapshot();
    });

    it('two_timestamps_bounded histogram (p90)', async () => {
      /*
        This test starts with 2 data points with bounds of [10, 30]:
          t0: [0, 0, 0]
          t1: [10, 10, 10]

        Since the AggregationTemporality is 2(cumulative), we need to calculate the delta between the two points:
          delta: [10, 10, 10] - [0, 0, 0] = [10, 10, 10]

        Total observations: 10 + 10 + 10 = 30
        Cumulative counts: [10, 20, 30]
        p90 point:
          Rank = 0.9 * 30 = 27
          This falls in the third bucket (since 20 < 27 ≤ 30)

        We need to interpolate between the lower and upper bounds of the third bucket:
          Lower bound: 30
          Upper bound: Infinity (but we use the upper bound of the previous bucket for the last bucket)
          Position in bucket: (27 - 20) / (30 - 20) = 0.7
          Interpolated value: 30 (since it's in the last bucket, we return the upper bound of the previous bucket)

        Thus the first point value would be 0 since it's at the start of the bounds.
        The second point value would be 30 since that is the 90th percentile point value delta from the first point.
       */
      const query = await renderChartConfig(
        {
          select: [
            {
              aggFn: 'quantile',
              level: 0.9,
              metricName: 'test.two_timestamps_lower_bound',
              metricType: MetricsDataType.Histogram,
              valueExpression: 'Value',
            },
          ],
          from: metricSource.from,
          where: '',
          metricTables: TEST_METRIC_TABLES,
          dateRange: [new Date(now), new Date(now + ms('2m'))],
          granularity: '1 minute',
          timestampValueExpression: metricSource.timestampValueExpression,
          connection: connection.id,
        },
        metadata,
      );
      const res = await queryData(query);
      expect(res).toMatchSnapshot();
    });

    it('two_timestamps_bounded histogram (p25)', async () => {
      /*
        This test starts with 2 data points with bounds of [10, 30]:
          t0: [0, 0, 0]
          t1: [10, 10, 10]

        Since the AggregationTemporality is 2(cumulative), we need to calculate the delta between the two points:
          delta: [10, 10, 10] - [0, 0, 0] = [10, 10, 10]

        Total observations: 10 + 10 + 10 = 30
        Cumulative counts: [10, 20, 30]
        p25 point:
          Rank = 0.25 * 30 = 7.5
          This falls in the first bucket (since 0 < 7.5 ≤ 10)

        We need to interpolate between the lower and upper bounds of the first bucket:
          Lower bound: 0 (implicit lower bound for first bucket)
          Upper bound: 10 (first explicit bound)
          Position in bucket: 7.5 / 10 = 0.75
          Interpolated value: 0 + 0.75 * (10 - 0) = 7.5

        Since all observations are in the first bucket which has an upper bound of 1:
          For the first bucket (≤ 0), the algorithm would interpolate, but since all values are in this bucket and it's the lowest bucket, it would return 10
          Thus the value columns in res should be [0, 10]
       */
      const query = await renderChartConfig(
        {
          select: [
            {
              aggFn: 'quantile',
              level: 0.25,
              metricName: 'test.two_timestamps_lower_bound',
              metricType: MetricsDataType.Histogram,
              valueExpression: 'Value',
            },
          ],
          from: metricSource.from,
          where: '',
          metricTables: TEST_METRIC_TABLES,
          dateRange: [new Date(now), new Date(now + ms('2m'))],
          granularity: '1 minute',
          timestampValueExpression: metricSource.timestampValueExpression,
          connection: connection.id,
        },
        metadata,
      );
      const res = await queryData(query);
      expect(res).toMatchSnapshot();
    });

    it('two_timestamps_lower_bound_inf histogram (p50)', async () => {
      /*
      This test starts with 2 data points with bounds of [1, 30]:
        t0: [0, 0, 0]
        t1: [10, 0, 0]

      Since the AggregationTemporality is 2(cumulative), we need to calculate the delta between the two points:
        delta: [10, 0, 0] - [0, 0, 0] = [10, 0, 0]

      Total observations: 10 + 0 + 0 = 10
      Cumulative counts: [10, 10, 10]
      p50 point:
        Rank = 0.5 * 10 = 5
        This falls in the first bucket (since 5 < 10)

      Since all observations are in the first bucket which has an upper bound of 1:
        For the first bucket (≤ 0), the algorithm would interpolate, but since all values are in this bucket and it's the lowest bucket, it would return 1
        Thus the value columns in res should be [0, 1]
    */
      const query = await renderChartConfig(
        {
          select: [
            {
              aggFn: 'quantile',
              level: 0.5,
              metricName: 'test.two_timestamps_lower_bound_inf',
              metricType: MetricsDataType.Histogram,
              valueExpression: 'Value',
            },
          ],
          from: metricSource.from,
          where: '',
          metricTables: TEST_METRIC_TABLES,
          dateRange: [new Date(now), new Date(now + ms('2m'))],
          granularity: '1 minute',
          timestampValueExpression: metricSource.timestampValueExpression,
          connection: connection.id,
        },
        metadata,
      );
      const res = await queryData(query);
      expect(res).toMatchSnapshot();
    });

    it('should bucket correctly when no grouping is defined', async () => {
      const query = await renderChartConfig(
        {
          select: [
            {
              aggFn: 'quantile',
              level: 0.5,
              metricName: 'test.send_latency',
              metricType: MetricsDataType.Histogram,
              valueExpression: 'Value',
            },
          ],
          from: metricSource.from,
          where: '',
          metricTables: TEST_METRIC_TABLES,
          dateRange: [new Date(now), new Date(now + ms('5m'))],
          granularity: '2 minute',
          timestampValueExpression: metricSource.timestampValueExpression,
          connection: connection.id,
        },
        metadata,
      );
      const res = await queryData(query);
      expect(res).toMatchSnapshot();
    });

    it('should bucket correctly when grouping by a single attribute', async () => {
      const query = await renderChartConfig(
        {
          select: [
            {
              aggFn: 'quantile',
              level: 0.5,
              metricName: 'test.send_latency',
              metricType: MetricsDataType.Histogram,
              valueExpression: 'Value',
            },
          ],
          from: metricSource.from,
          where: '',
          metricTables: TEST_METRIC_TABLES,
          dateRange: [new Date(now), new Date(now + ms('5m'))],
          groupBy: `ResourceAttributes['host']`,
          granularity: '2 minute',
          timestampValueExpression: metricSource.timestampValueExpression,
          connection: connection.id,
        },
        metadata,
      );
      const res = await queryData(query);
      expect(res).toMatchSnapshot();
    });

    it('should bucket correctly when grouping by multiple attributes', async () => {
      const query = await renderChartConfig(
        {
          select: [
            {
              aggFn: 'quantile',
              level: 0.5,
              metricName: 'test.send_latency',
              metricType: MetricsDataType.Histogram,
              valueExpression: 'Value',
            },
          ],
          from: metricSource.from,
          where: '',
          metricTables: TEST_METRIC_TABLES,
          dateRange: [new Date(now), new Date(now + ms('5m'))],
          groupBy: `ResourceAttributes['host'], ResourceAttributes['service']`,
          granularity: '2 minute',
          timestampValueExpression: metricSource.timestampValueExpression,
          connection: connection.id,
        },
        metadata,
      );
      const res = await queryData(query);
      expect(res).toMatchSnapshot();
    });
  });

  describe('K8s Semantic Convention Migrations with metricNameSql', () => {
    beforeEach(async () => {
      // Insert gauge metrics with old semantic convention (ScopeVersion < 0.125.0)
      const oldVersionGaugePoints = [
        { value: 45, timestamp: now, ScopeVersion: '0.124.0' },
        { value: 50, timestamp: now + ms('1m'), ScopeVersion: '0.124.0' },
        { value: 55, timestamp: now + ms('2m'), ScopeVersion: '0.124.0' },
      ].map(point => ({
        MetricName: 'k8s.pod.cpu.utilization',
        ServiceName: 'k8s-monitor',
        ResourceAttributes: {
          'k8s.pod.name': 'test-pod',
          'k8s.namespace.name': 'default',
        },
        Value: point.value,
        TimeUnix: new Date(point.timestamp),
        ScopeVersion: point.ScopeVersion,
      }));

      // Insert gauge metrics with new semantic convention (ScopeVersion >= 0.125.0)
      const newVersionGaugePoints = [
        { value: 60, timestamp: now + ms('3m'), ScopeVersion: '0.125.0' },
        { value: 65, timestamp: now + ms('4m'), ScopeVersion: '0.125.0' },
        { value: 70, timestamp: now + ms('5m'), ScopeVersion: '0.126.0' },
      ].map(point => ({
        MetricName: 'k8s.pod.cpu.usage',
        ServiceName: 'k8s-monitor',
        ResourceAttributes: {
          'k8s.pod.name': 'test-pod',
          'k8s.namespace.name': 'default',
        },
        Value: point.value,
        TimeUnix: new Date(point.timestamp),
        ScopeVersion: point.ScopeVersion,
      }));

      await bulkInsertMetricsGauge([
        ...oldVersionGaugePoints,
        ...newVersionGaugePoints,
      ]);
    });

    it('should query k8s.pod.cpu.utilization gauge metric using metricNameSql to handle both old and new conventions', async () => {
      const query = await renderChartConfig(
        {
          select: [
            {
              aggFn: 'avg',
              metricName: 'k8s.pod.cpu.utilization',
              metricNameSql:
                "(MetricName = 'k8s.pod.cpu.utilization' OR MetricName = 'k8s.pod.cpu.usage')",
              metricType: MetricsDataType.Gauge,
              valueExpression: 'Value',
            },
          ],
          from: metricSource.from,
          where: '',
          metricTables: TEST_METRIC_TABLES,
          dateRange: [new Date(now), new Date(now + ms('10m'))],
          granularity: '1 minute',
          timestampValueExpression: metricSource.timestampValueExpression,
          connection: connection.id,
        },
        metadata,
      );

      const res = await queryData(query);
      // Should return data from both old (k8s.pod.cpu.utilization) and new (k8s.pod.cpu.usage) metric names
      expect(res.length).toBeGreaterThan(0);
      expect(res).toMatchSnapshot();

      // Verify the SQL contains the OR-based metric name condition
      expect(query.sql).toContain('k8s.pod.cpu.usage');
      expect(query.sql).toContain('k8s.pod.cpu.utilization');
      expect(query.sql).toMatch(/MetricName = .* OR MetricName = /);
    });

    it('should handle gauge metric with metricNameSql and groupBy', async () => {
      const query = await renderChartConfig(
        {
          select: [
            {
              aggFn: 'avg',
              metricName: 'k8s.pod.cpu.utilization',
              metricNameSql:
                "(MetricName = 'k8s.pod.cpu.utilization' OR MetricName = 'k8s.pod.cpu.usage')",
              metricType: MetricsDataType.Gauge,
              valueExpression: 'Value',
            },
          ],
          from: metricSource.from,
          where: '',
          metricTables: TEST_METRIC_TABLES,
          dateRange: [new Date(now), new Date(now + ms('10m'))],
          granularity: '1 minute',
          groupBy: `ResourceAttributes['k8s.pod.name']`,
          timestampValueExpression: metricSource.timestampValueExpression,
          connection: connection.id,
        },
        metadata,
      );

      const res = await queryData(query);
      expect(res.length).toBeGreaterThan(0);
      expect(res).toMatchSnapshot();
    });

    it('should handle metrics without metricNameSql (backward compatibility)', async () => {
      // Test querying the old metric name directly without migration SQL
      const query = await renderChartConfig(
        {
          select: [
            {
              aggFn: 'avg',
              metricName: 'k8s.pod.cpu.utilization',
              // No metricNameSql provided - should query old name only
              metricType: MetricsDataType.Gauge,
              valueExpression: 'Value',
            },
          ],
          from: metricSource.from,
          where: '',
          metricTables: TEST_METRIC_TABLES,
          dateRange: [new Date(now), new Date(now + ms('10m'))],
          granularity: '1 minute',
          timestampValueExpression: metricSource.timestampValueExpression,
          connection: connection.id,
        },
        metadata,
      );

      const res = await queryData(query);
      // Should only return data from old metric name (k8s.pod.cpu.utilization)
      expect(res).toMatchSnapshot();

      // Verify the SQL uses simple string comparison (not OR-based)
      expect(query.sql).toContain("MetricName = 'k8s.pod.cpu.utilization'");
      expect(query.sql).not.toMatch(/MetricName = .* OR MetricName = /);
    });
  });
});
