// TODO: we might want to move this test file to common-utils package

import { ChSql, chSql } from '@hyperdx/common-utils/dist/clickhouse';
import { ClickhouseClient } from '@hyperdx/common-utils/dist/clickhouse/node';
import { getMetadata } from '@hyperdx/common-utils/dist/core/metadata';
import { renderChartConfig } from '@hyperdx/common-utils/dist/core/renderChartConfig';
import {
  MetricsDataType,
  QuerySettings,
} from '@hyperdx/common-utils/dist/types';
import _ from 'lodash';
import ms from 'ms';

import * as config from '@/config';
import { createTeam } from '@/controllers/team';
import {
  bucketExponentialHistogramObservations,
  bulkInsertLogs,
  bulkInsertMetricsGauge,
  bulkInsertMetricsHistogram,
  bulkInsertMetricsSum,
  DEFAULT_DATABASE,
  DEFAULT_LOGS_TABLE,
  DEFAULT_METRICS_TABLE,
  executeSqlCommand,
  getServer,
  seedExponentialHistogramMetric,
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

const querySettings: QuerySettings = [
  { setting: 'optimize_read_in_order', value: '0' },
  { setting: 'cast_keep_nullable', value: '1' },
  { setting: 'count_distinct_implementation', value: 'uniqCombined64' },
  { setting: 'async_insert_busy_timeout_min_ms', value: '20000' },
];

describe('renderChartConfig', () => {
  const server = getServer();

  const now = new Date('2022-01-05').getTime();
  let team, connection, logSource, metricSource, metadata;
  let clickhouseClient: ClickhouseClient;

  const nowPlus = time_val => new Date(now + ms(time_val));
  const toClickHouseISOString = (date: Date) =>
    date.toISOString().replace('.000Z', 'Z');

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
            databaseName: DEFAULT_DATABASE,
            tableName: `agg_fn_str_test`,
          },
          where: '',
          connection: connection.id,
          timestampValueExpression: 'ts',
        },
        metadata,
        querySettings,
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
            databaseName: DEFAULT_DATABASE,
            tableName: `agg_fn_default_test`,
          },
          where: '',
          connection: connection.id,
          timestampValueExpression: 'ts',
        },
        metadata,
        querySettings,
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
        querySettings,
      );

      expect(await queryData(query)).toMatchSnapshot();
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
        querySettings,
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
        querySettings,
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
        querySettings,
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
        querySettings,
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
        querySettings,
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
        querySettings,
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
        querySettings,
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
        querySettings,
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
        querySettings,
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
        querySettings,
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
        querySettings,
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
        querySettings,
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
        querySettings,
      );
      expect(await queryData(maxQuery)).toMatchSnapshot('maxSum');
    });

    it('new series appearing mid-window: v2 suppresses first-row spike', async () => {
      // Scenario: An existing series (customerA) has data from the start,
      // and a new series (customerB) appears mid-window with a high
      // cumulative counter value (e.g. 10000). A naive inter-bucket diff
      // approach would leak the full cumulative value as a spike on the
      // first bucket of customerB. The v2 lagInFrame-based Rate yields 0
      // for the first row of each series, preventing the spike.

      // Use a unique metric name to isolate from the beforeEach data.
      const metricName = 'customer.events.total';

      // customerA: present from the start, steady increase
      const customerAPoints = [
        { value: 0, timestamp: now - ms('1m') },
        { value: 10, timestamp: now + ms('2m') },
        { value: 20, timestamp: now + ms('7m') },
        { value: 30, timestamp: now + ms('12m') },
        { value: 40, timestamp: now + ms('17m') },
      ].map(point => ({
        MetricName: metricName,
        ServiceName: 'api',
        ResourceAttributes: { customer: 'customerA' },
        Value: point.value,
        TimeUnix: new Date(point.timestamp),
        IsMonotonic: true,
        AggregationTemporality: 2, // Cumulative
      }));

      // customerB: appears at +10m with a high cumulative value (10000),
      // then increases to 10050 by +17m. The real per-bucket increase is
      // only 50. A naive approach would show 10000 in the bucket where it
      // first appears.
      const customerBPoints = [
        { value: 10000, timestamp: now + ms('10m') },
        { value: 10020, timestamp: now + ms('12m') },
        { value: 10050, timestamp: now + ms('17m') },
      ].map(point => ({
        MetricName: metricName,
        ServiceName: 'api',
        ResourceAttributes: { customer: 'customerB' },
        Value: point.value,
        TimeUnix: new Date(point.timestamp),
        IsMonotonic: true,
        AggregationTemporality: 2, // Cumulative
      }));

      await bulkInsertMetricsSum([...customerAPoints, ...customerBPoints]);

      // --- v2 query (current code with lagInFrame) ---
      const v2Query = await renderChartConfig(
        {
          select: [
            {
              aggFn: 'sum',
              metricName: metricName,
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
        querySettings,
      );
      const v2Results = await queryData(v2Query);

      // v2 should NOT have a spike — the max bucket value should be much
      // smaller than customerB's initial cumulative value (10000). The real
      // per-bucket increases across both series are at most ~50.
      const v2Values = v2Results.map((r: any) => Number(r.Value));
      const v2MaxValue = Math.max(...v2Values);
      expect(v2MaxValue).toBeLessThan(100);

      // Verify we actually got data back (not an empty result set).
      expect(v2Results.length).toBeGreaterThan(0);
    });

    it('cross-scope same-key attributes split into two series under variadic AttributesHash (HDX-4466)', async () => {
      // HDX-4466 pinning test. Two cumulative Sum rows that carry the same
      // logical attribute set ({service.name: api, host: h1}) but distribute
      // the host key across different attribute scopes:
      //
      //   Row A: ResourceAttributes={service.name: api, host: h1}, Attributes={}
      //   Row B: ResourceAttributes={service.name: api},           Attributes={host: h1}
      //
      // AttributesHash is now computed as the variadic
      //   cityHash64(ScopeAttributes, ResourceAttributes, Attributes)
      // for all metric schemas (Map and JSON), so the two rows hash
      // distinctly: each lands in its own series. Both rows are then the
      // first row of their respective series, the lagInFrame Rate is NULL
      // for both, and the bucketed Sum aggregation collapses to 0 for the
      // bucket holding them.
      //
      // Pre-HDX-4466 (Map schema only) this was different: the Map path
      // wrapped the three maps in mapConcat() before hashing, which
      // collapsed both rows into a single series. Row B's lagInFrame
      // captured the cumulative increase (110 - 100 = 10) and the bucket
      // reported Value=10. The pre-refactor commit pinned that behaviour;
      // this assertion records the variadic outcome that replaced it.
      const metricName = 'hdx4466.cross_scope.events.total';

      await bulkInsertMetricsSum([
        {
          MetricName: metricName,
          ServiceName: 'api',
          ResourceAttributes: { 'service.name': 'api', host: 'h1' },
          Attributes: {},
          Value: 100,
          TimeUnix: new Date(now + ms('1m')),
          IsMonotonic: true,
          AggregationTemporality: 2, // Cumulative
        },
        {
          MetricName: metricName,
          ServiceName: 'api',
          ResourceAttributes: { 'service.name': 'api' },
          Attributes: { host: 'h1' },
          Value: 110,
          TimeUnix: new Date(now + ms('2m')),
          IsMonotonic: true,
          AggregationTemporality: 2, // Cumulative
        },
      ]);

      const query = await renderChartConfig(
        {
          select: [
            {
              aggFn: 'sum',
              metricName,
              metricType: MetricsDataType.Sum,
              valueExpression: 'Value',
            },
          ],
          from: metricSource.from,
          where: '',
          metricTables: TEST_METRIC_TABLES,
          dateRange: [new Date(now), new Date(now + ms('5m'))],
          granularity: '5 minute',
          timestampValueExpression: metricSource.timestampValueExpression,
          connection: connection.id,
        },
        metadata,
        querySettings,
      );

      const results = await queryData(query);

      // Under variadic AttributesHash, both rows are first-in-series, so
      // no rate is captured and the bucketed Sum collapses to 0. A
      // regression that reintroduced mapConcat-style collapsing would
      // produce Value=10 in the populated bucket, failing this check.
      const totalValue = results.reduce(
        (acc: number, r: any) => acc + (r.Value == null ? 0 : Number(r.Value)),
        0,
      );
      expect(totalValue).toBe(0);

      // Snapshot pins the bucketed output for the two-series-split case.
      expect(results).toMatchSnapshot();
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
        querySettings,
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
        querySettings,
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
        querySettings,
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
        querySettings,
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
        querySettings,
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
        querySettings,
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
        querySettings,
      );
      const res = await queryData(query);
      expect(res).toMatchSnapshot();
    });
  });

  describe('Query Metrics - Exponential Histogram', () => {
    type QuantileResult = {
      __hdx_time_bucket: string;
      Value: number;
      group?: string[];
    };

    const isQuantileResult = (result: unknown): result is QuantileResult =>
      typeof result === 'object' &&
      result !== null &&
      '__hdx_time_bucket' in result &&
      typeof result.__hdx_time_bucket === 'string' &&
      'Value' in result &&
      typeof result.Value === 'number' &&
      (!('group' in result) ||
        (Array.isArray(result.group) &&
          result.group.every(value => typeof value === 'string')));

    const queryQuantile = async (
      level: number,
      metricName: string,
      {
        dateRange = [new Date(now), nowPlus('2m')],
        granularity = '1 minute',
        groupBy,
        where = '',
      }: {
        dateRange?: [Date, Date];
        granularity?: '1 minute' | null;
        groupBy?: string;
        where?: string;
      } = {},
    ) => {
      const query = await renderChartConfig(
        {
          select: [
            {
              aggFn: 'quantile',
              level,
              metricName,
              metricType: MetricsDataType.ExponentialHistogram,
              valueExpression: 'Value',
            },
          ],
          from: metricSource.from,
          where,
          metricTables: TEST_METRIC_TABLES,
          dateRange,
          groupBy,
          granularity: granularity ?? undefined,
          timestampValueExpression: metricSource.timestampValueExpression,
          connection: connection.id,
        },
        metadata,
        querySettings,
      );

      const results = await queryData(query);
      if (!results.every(isQuantileResult)) {
        throw new Error('unexpected exponential histogram query result');
      }
      return results;
    };

    const seedGroupedCumulativeSeries = async ({
      attributes,
      metricName,
      observations,
    }: {
      attributes: Record<string, string>;
      metricName: string;
      observations: number[];
    }) =>
      seedExponentialHistogramMetric({
        metricName,
        points: [
          {
            TimeUnix: new Date(now),
            Attributes: attributes,
            ...bucketExponentialHistogramObservations([]),
          },
          {
            TimeUnix: nowPlus('1m'),
            Attributes: attributes,
            ...bucketExponentialHistogramObservations(observations),
          },
        ],
      });

    it('calculates a quantile for a single series', async () => {
      await seedExponentialHistogramMetric({
        metricName: 'test.request.duration',
        points: [
          {
            TimeUnix: new Date(now),
            ...bucketExponentialHistogramObservations([]),
          },
          {
            TimeUnix: nowPlus('1m'),
            ...bucketExponentialHistogramObservations([2, 4]),
          },
        ],
      });

      expect(await queryQuantile(0.5, 'test.request.duration')).toEqual([
        {
          __hdx_time_bucket: toClickHouseISOString(nowPlus('1m')),
          Value: 2,
        },
      ]);
    });

    it('returns no rows when no data points match the query', async () => {
      expect(await queryQuantile(0.5, 'test.metric.never.seeded')).toEqual([]);
    });

    it('uses logarithmic interpolation within a positive exponential bucket', async () => {
      await seedExponentialHistogramMetric({
        metricName: 'test.positive.interpolation',
        points: [
          {
            TimeUnix: new Date(now),
            ...bucketExponentialHistogramObservations([]),
          },
          {
            TimeUnix: nowPlus('1m'),
            ...bucketExponentialHistogramObservations([4, 4]),
          },
        ],
      });

      const [result] = await queryQuantile(0.5, 'test.positive.interpolation');

      // At scale 0, both observations occupy (2, 4]. Halfway through an
      // exponential bucket is its geometric midpoint: 2 * sqrt(2), not 3.
      expect(result.__hdx_time_bucket).toBe(
        toClickHouseISOString(nowPlus('1m')),
      );
      expect(result.Value).toBeCloseTo(Math.sqrt(8));
    });

    it('orders negative buckets before zero and interpolates them toward zero', async () => {
      await seedExponentialHistogramMetric({
        metricName: 'test.negative.interpolation',
        points: [
          {
            TimeUnix: new Date(now),
            ...bucketExponentialHistogramObservations([]),
          },
          {
            TimeUnix: nowPlus('1m'),
            ...bucketExponentialHistogramObservations([-4, -4, 0, 2]),
          },
        ],
      });

      const [result] = await queryQuantile(0.25, 'test.negative.interpolation');

      // The first two observations are in [-4, -2). Rank 1 is halfway through
      // that bucket, whose logarithmic midpoint is -2 * sqrt(2).
      expect(result.Value).toBeCloseTo(-Math.sqrt(8));
    });

    it('orders multiple populated negative buckets from the largest magnitude toward zero', async () => {
      await seedExponentialHistogramMetric({
        metricName: 'test.negative.multiple.bucket.order',
        aggregationTemporality: 1,
        points: [
          {
            TimeUnix: nowPlus('1m'),
            ...bucketExponentialHistogramObservations([-8, -8, -4, -2]),
          },
        ],
      });

      const [result] = await queryQuantile(
        0.375,
        'test.negative.multiple.bucket.order',
      );

      // Negative buckets are traversed as [-8, -4), [-4, -2), [-2, -1).
      // Rank 1.5 is 75% of the way through the first two-count bucket, so
      // logarithmic interpolation toward zero gives -2^2.25.
      expect(result.Value).toBeCloseTo(-(2 ** 2.25));
    });

    it('returns zero when the requested rank falls in the zero bucket', async () => {
      await seedExponentialHistogramMetric({
        metricName: 'test.zero.bucket',
        points: [
          {
            TimeUnix: new Date(now),
            ...bucketExponentialHistogramObservations([]),
          },
          {
            TimeUnix: nowPlus('1m'),
            ...bucketExponentialHistogramObservations([-2, 0, 0, 4]),
          },
        ],
      });

      // One negative observation precedes two zero observations, so rank 2
      // falls in the zero bucket and the median is exactly zero.
      expect(await queryQuantile(0.5, 'test.zero.bucket')).toEqual([
        {
          __hdx_time_bucket: toClickHouseISOString(nowPlus('1m')),
          Value: 0,
        },
      ]);
    });

    it('returns a negative bucket upper boundary when the rank ends at the zero bucket border', async () => {
      await seedExponentialHistogramMetric({
        metricName: 'test.negative.zero.border',
        aggregationTemporality: 1,
        points: [
          {
            TimeUnix: nowPlus('1m'),
            ...bucketExponentialHistogramObservations([-4, -4, 0, 0]),
          },
        ],
      });

      // Rank 2 ends exactly at the top of negative bucket [-4, -2), just
      // before the zero bucket begins. The sign-flip boundary must resolve to
      // the bucket's upper boundary -2, not to zero.
      expect(await queryQuantile(0.5, 'test.negative.zero.border')).toEqual([
        {
          __hdx_time_bucket: toClickHouseISOString(nowPlus('1m')),
          Value: -2,
        },
      ]);
    });

    it('returns the outer bucket boundaries for quantile levels zero and one', async () => {
      const metricName = 'test.quantile.endpoints';
      await seedExponentialHistogramMetric({
        metricName,
        aggregationTemporality: 1,
        points: [
          {
            TimeUnix: nowPlus('1m'),
            ...bucketExponentialHistogramObservations([-8, -4, 2, 4]),
          },
        ],
      });

      // Level zero starts at the lower numeric boundary of the first negative
      // bucket. Level one ends at the upper boundary of the last positive one.
      expect((await queryQuantile(0, metricName))[0]?.Value).toBe(-8);
      expect((await queryQuantile(1, metricName))[0]?.Value).toBe(4);
    });

    it('returns single-sided outer boundaries for quantile levels zero and one', async () => {
      const negativeOnly = 'test.quantile.endpoints.negative.only';
      const positiveOnly = 'test.quantile.endpoints.positive.only';
      await seedExponentialHistogramMetric({
        metricName: negativeOnly,
        aggregationTemporality: 1,
        points: [
          {
            TimeUnix: nowPlus('1m'),
            ...bucketExponentialHistogramObservations([-4, -2]),
          },
        ],
      });
      await seedExponentialHistogramMetric({
        metricName: positiveOnly,
        aggregationTemporality: 1,
        points: [
          {
            TimeUnix: nowPlus('1m'),
            ...bucketExponentialHistogramObservations([2, 4]),
          },
        ],
      });

      // With only negative buckets, level one must end at the upper (least
      // negative) boundary of [-2, -1) and stay negative. With only positive
      // buckets, level zero starts at the lower boundary of (1, 2].
      expect((await queryQuantile(1, negativeOnly))[0]?.Value).toBe(-1);
      expect((await queryQuantile(0, positiveOnly))[0]?.Value).toBe(1);
    });

    it('returns zero for quantile levels zero and one when only the zero bucket is populated', async () => {
      const metricName = 'test.quantile.endpoints.zero.only';
      await seedExponentialHistogramMetric({
        metricName,
        aggregationTemporality: 1,
        points: [
          {
            TimeUnix: nowPlus('1m'),
            ...bucketExponentialHistogramObservations([0, 0]),
          },
        ],
      });

      // With empty negative and positive bucket arrays, both endpoint levels
      // resolve within the zero bucket, which represents exactly zero.
      expect((await queryQuantile(0, metricName))[0]?.Value).toBe(0);
      expect((await queryQuantile(1, metricName))[0]?.Value).toBe(0);
    });

    it('subtracts cumulative bucket counts instead of quantiling lifetime counts', async () => {
      const startTime = nowPlus('-1m');
      await seedExponentialHistogramMetric({
        metricName: 'test.cumulative.delta',
        points: [
          {
            TimeUnix: new Date(now),
            StartTimeUnix: startTime,
            ...bucketExponentialHistogramObservations([2, 2]),
          },
          {
            TimeUnix: nowPlus('1m'),
            StartTimeUnix: startTime,
            ...bucketExponentialHistogramObservations([2, 2, 4, 4]),
          },
        ],
      });

      const [result] = await queryQuantile(0.5, 'test.cumulative.delta');

      // Only the two newly recorded 4s belong to the second interval. Including
      // the lifetime 2s would place the median at 2 instead of 2 * sqrt(2).
      expect(result.__hdx_time_bucket).toBe(
        toClickHouseISOString(nowPlus('1m')),
      );
      expect(result.Value).toBeCloseTo(Math.sqrt(8));
    });

    it('uses a cumulative warm-up point outside the requested range as the subtraction baseline', async () => {
      const startTime = nowPlus('-2m');
      await seedExponentialHistogramMetric({
        metricName: 'test.cumulative.warmup',
        points: [
          {
            TimeUnix: nowPlus('-1m'),
            StartTimeUnix: startTime,
            ...bucketExponentialHistogramObservations([2, 2]),
          },
          {
            TimeUnix: new Date(now),
            StartTimeUnix: startTime,
            ...bucketExponentialHistogramObservations([2, 2, 4, 4]),
          },
        ],
      });

      const [result] = await queryQuantile(0.5, 'test.cumulative.warmup');

      // The -1m point is fetched only to establish the baseline. It must not be
      // returned, and the first visible bucket contains only the two new 4s.
      expect(result.__hdx_time_bucket).toBe(
        toClickHouseISOString(new Date(now)),
      );
      expect(result.Value).toBeCloseTo(Math.sqrt(8));
    });

    it('emits no value for a predecessor-less cumulative point whose start predates the requested range', async () => {
      await seedExponentialHistogramMetric({
        metricName: 'test.cumulative.missing.predecessor',
        points: [
          {
            TimeUnix: nowPlus('1m'),
            StartTimeUnix: nowPlus('-10m'),
            ...bucketExponentialHistogramObservations([2, 2, 4, 4]),
          },
        ],
      });

      // With no predecessor, the portion of the lifetime counts belonging to
      // this interval is unknowable. Returning no quantile avoids a false spike.
      expect(
        await queryQuantile(0.5, 'test.cumulative.missing.predecessor'),
      ).toEqual([]);
    });

    it('emits no value for a predecessor-less cumulative point whose start falls inside the requested range', async () => {
      await seedExponentialHistogramMetric({
        metricName: 'test.cumulative.midrange.start',
        points: [
          {
            TimeUnix: nowPlus('1m'),
            StartTimeUnix: nowPlus('30s'),
            ...bucketExponentialHistogramObservations([2, 2]),
          },
        ],
      });

      // Even though this new series' entire lifetime lies inside the requested
      // range, a predecessor-less cumulative point is suppressed rather than
      // attributed to the chart bucket it first appears in.
      expect(
        await queryQuantile(0.5, 'test.cumulative.midrange.start'),
      ).toEqual([]);
    });

    it('emits no value when the cumulative baseline precedes the one-interval warm-up window', async () => {
      const startTime = nowPlus('-3m');
      await seedExponentialHistogramMetric({
        metricName: 'test.cumulative.stale.baseline',
        points: [
          {
            TimeUnix: nowPlus('-2m'),
            StartTimeUnix: startTime,
            ...bucketExponentialHistogramObservations([2, 2]),
          },
          {
            TimeUnix: nowPlus('1m'),
            StartTimeUnix: startTime,
            ...bucketExponentialHistogramObservations([2, 2, 4, 4]),
          },
        ],
      });

      // The warm-up fetch reaches back exactly one granularity interval, so a
      // baseline two minutes before the range is never read. The in-range
      // point is then predecessor-less and contributes nothing.
      expect(
        await queryQuantile(0.5, 'test.cumulative.stale.baseline'),
      ).toEqual([]);
    });

    it('treats an unknown-start reset point as zero contribution and uses it as the next baseline', async () => {
      const originalStartTime = nowPlus('-1m');
      const resetTime = nowPlus('1m');
      await seedExponentialHistogramMetric({
        metricName: 'test.cumulative.unknown.reset',
        points: [
          {
            TimeUnix: new Date(now),
            StartTimeUnix: originalStartTime,
            ...bucketExponentialHistogramObservations([2, 2]),
          },
          {
            TimeUnix: resetTime,
            StartTimeUnix: resetTime,
            ...bucketExponentialHistogramObservations([4, 4]),
          },
          {
            TimeUnix: nowPlus('2m'),
            StartTimeUnix: resetTime,
            ...bucketExponentialHistogramObservations([2, 4, 4]),
          },
        ],
      });

      // StartTimeUnix == TimeUnix marks an unknown-start reset and contributes
      // nothing at 1m. The 2m point subtracts that marker, leaving only one 2.
      const [result] = await queryQuantile(
        0.5,
        'test.cumulative.unknown.reset',
      );
      expect(result.__hdx_time_bucket).toBe(
        toClickHouseISOString(nowPlus('2m')),
      );
      expect(result.Value).toBeCloseTo(Math.sqrt(2));
    });

    it('handles an unknown-start cumulative reset spanning negative, zero, and positive buckets', async () => {
      const resetTime = nowPlus('1m');
      await seedExponentialHistogramMetric({
        metricName: 'test.cumulative.unknown.reset.all.buckets',
        points: [
          {
            TimeUnix: new Date(now),
            StartTimeUnix: nowPlus('-1m'),
            ...bucketExponentialHistogramObservations([2, 2]),
          },
          {
            TimeUnix: resetTime,
            StartTimeUnix: resetTime,
            ...bucketExponentialHistogramObservations([-4, 0, 2]),
          },
          {
            TimeUnix: nowPlus('2m'),
            StartTimeUnix: resetTime,
            ...bucketExponentialHistogramObservations([-4, -2, 0, 2]),
          },
        ],
      });

      const [result] = await queryQuantile(
        0.5,
        'test.cumulative.unknown.reset.all.buckets',
      );

      // The reset marker's negative, zero, and positive counts contribute
      // nothing. The next point subtracts all three sides of that baseline,
      // leaving only the newly recorded -2 in negative bucket [-2, -1).
      expect(result.__hdx_time_bucket).toBe(
        toClickHouseISOString(nowPlus('2m')),
      );
      expect(result.Value).toBeCloseTo(-Math.sqrt(2));
    });

    it('uses all current counts after a known cumulative reset', async () => {
      await seedExponentialHistogramMetric({
        metricName: 'test.cumulative.known.reset',
        points: [
          {
            TimeUnix: new Date(now),
            StartTimeUnix: nowPlus('-1m'),
            ...bucketExponentialHistogramObservations([2, 2]),
          },
          {
            TimeUnix: nowPlus('1m'),
            StartTimeUnix: nowPlus('30s'),
            ...bucketExponentialHistogramObservations([4, 4]),
          },
        ],
      });

      const [result] = await queryQuantile(0.5, 'test.cumulative.known.reset');

      // The changed start time is earlier than the point time, so this is a
      // known reset with an implicit zero baseline. Both new-sequence 4s count.
      expect(result.Value).toBeCloseTo(Math.sqrt(8));
    });

    it('uses the complete negative, zero, and positive distribution after a known cumulative reset', async () => {
      await seedExponentialHistogramMetric({
        metricName: 'test.cumulative.known.reset.all.buckets',
        points: [
          {
            TimeUnix: new Date(now),
            StartTimeUnix: nowPlus('-1m'),
            ...bucketExponentialHistogramObservations([-4, -4, 0, 0, 2, 2]),
          },
          {
            TimeUnix: nowPlus('1m'),
            StartTimeUnix: nowPlus('30s'),
            ...bucketExponentialHistogramObservations([-2, 0, 4]),
          },
        ],
      });

      // The changed start time begins a true reset sequence, so none of the old
      // negative, zero, or positive counts are subtracted. In the new three-count
      // distribution, rank 1.5 falls in the zero bucket.
      expect(
        await queryQuantile(0.5, 'test.cumulative.known.reset.all.buckets'),
      ).toEqual([
        {
          __hdx_time_bucket: toClickHouseISOString(nowPlus('1m')),
          Value: 0,
        },
      ]);
    });

    it('detects a cumulative reset from a decreased zero count with an unchanged start time', async () => {
      const startTime = nowPlus('-1m');
      await seedExponentialHistogramMetric({
        metricName: 'test.cumulative.reset.zero.decrease',
        points: [
          {
            TimeUnix: new Date(now),
            StartTimeUnix: startTime,
            ...bucketExponentialHistogramObservations([0, 0, 2]),
          },
          {
            TimeUnix: nowPlus('1m'),
            StartTimeUnix: startTime,
            ...bucketExponentialHistogramObservations([0, 2, 4]),
          },
        ],
      });

      const [result] = await queryQuantile(
        0.5,
        'test.cumulative.reset.zero.decrease',
      );

      // ZeroCount falls from two to one while every existing positive bucket
      // is nondecreasing. The decrease alone identifies a reset, so the entire
      // current [0, 2, 4] distribution is used and p50 is sqrt(2).
      expect(result.Value).toBeCloseTo(Math.sqrt(2));
    });

    it('detects a cumulative reset from a decreased positive bucket with an unchanged start time', async () => {
      const startTime = nowPlus('-1m');
      await seedExponentialHistogramMetric({
        metricName: 'test.cumulative.reset.positive.decrease',
        points: [
          {
            TimeUnix: new Date(now),
            StartTimeUnix: startTime,
            ...bucketExponentialHistogramObservations([0, 2, 2]),
          },
          {
            TimeUnix: nowPlus('1m'),
            StartTimeUnix: startTime,
            ...bucketExponentialHistogramObservations([0, 2, 4]),
          },
        ],
      });

      const [result] = await queryQuantile(
        0.5,
        'test.cumulative.reset.positive.decrease',
      );

      // The count in positive bucket (1, 2] falls from two to one while the
      // zero count is unchanged. Treating the point as a new sequence yields
      // the current [0, 2, 4] distribution and p50 = sqrt(2).
      expect(result.Value).toBeCloseTo(Math.sqrt(2));
    });

    it('detects a cumulative reset from a decreased negative bucket with an unchanged start time', async () => {
      const startTime = nowPlus('-1m');
      await seedExponentialHistogramMetric({
        metricName: 'test.cumulative.reset.negative.decrease',
        points: [
          {
            TimeUnix: new Date(now),
            StartTimeUnix: startTime,
            ...bucketExponentialHistogramObservations([0, -2, -2]),
          },
          {
            TimeUnix: nowPlus('1m'),
            StartTimeUnix: startTime,
            ...bucketExponentialHistogramObservations([0, -2, -4]),
          },
        ],
      });

      const [result] = await queryQuantile(
        0.5,
        'test.cumulative.reset.negative.decrease',
      );

      // The [-2, -1) bucket falls from two to one while ZeroCount is stable.
      // The current [-4, -2, 0] distribution is therefore used directly;
      // rank 1.5 lies halfway through [-2, -1), giving -sqrt(2).
      expect(result.Value).toBeCloseTo(-Math.sqrt(2));
    });

    it('detects a cumulative reset when a previous bucket disappears outside the current range', async () => {
      const startTime = nowPlus('-1m');
      await seedExponentialHistogramMetric({
        metricName: 'test.cumulative.reset.disappearing.bucket',
        points: [
          {
            TimeUnix: new Date(now),
            StartTimeUnix: startTime,
            ...bucketExponentialHistogramObservations([2, 2]),
          },
          {
            TimeUnix: nowPlus('1m'),
            StartTimeUnix: startTime,
            ...bucketExponentialHistogramObservations([4, 4]),
          },
        ],
      });

      const [result] = await queryQuantile(
        0.5,
        'test.cumulative.reset.disappearing.bucket',
      );

      // PositiveOffset moves from bucket index 0 to 1. Looking up the missing
      // old bucket as zero detects its decrease and treats both current 4s as
      // the new sequence, whose p50 is the bucket midpoint sqrt(8).
      expect(result.Value).toBeCloseTo(Math.sqrt(8));
    });

    it('detects a cumulative reset when the current range shrinks below a previous upper bucket', async () => {
      const startTime = nowPlus('-1m');
      await seedExponentialHistogramMetric({
        metricName: 'test.cumulative.reset.shrinking.range',
        points: [
          {
            TimeUnix: new Date(now),
            StartTimeUnix: startTime,
            ...bucketExponentialHistogramObservations([2, 8]),
          },
          {
            TimeUnix: nowPlus('1m'),
            StartTimeUnix: startTime,
            ...bucketExponentialHistogramObservations([2, 2]),
          },
        ],
      });

      const [result] = await queryQuantile(
        0.5,
        'test.cumulative.reset.shrinking.range',
      );

      // The current array covers only bucket index 0, while the previous
      // point held a positive count in bucket index 2 above that range. The
      // vanished count is a decrease, so both current 2s form a new sequence
      // whose p50 is the bucket midpoint sqrt(2).
      expect(result.Value).toBeCloseTo(Math.sqrt(2));
    });

    it('detects a cumulative reset when the current negative range shrinks below a previous upper bucket', async () => {
      const startTime = nowPlus('-1m');
      await seedExponentialHistogramMetric({
        metricName: 'test.cumulative.reset.shrinking.negative.range',
        points: [
          {
            TimeUnix: new Date(now),
            StartTimeUnix: startTime,
            ...bucketExponentialHistogramObservations([-2, -8]),
          },
          {
            TimeUnix: nowPlus('1m'),
            StartTimeUnix: startTime,
            ...bucketExponentialHistogramObservations([-2, -2]),
          },
        ],
      });

      const [result] = await queryQuantile(
        0.5,
        'test.cumulative.reset.shrinking.negative.range',
      );

      // Mirror of the positive shrinking-range case: the previous -8 count
      // sits above the current negative bucket range, so its disappearance
      // marks a reset and both current -2s count, giving p50 -sqrt(2).
      expect(result.Value).toBeCloseTo(-Math.sqrt(2));
    });

    it('uses delta-temporality bucket counts directly without subtracting the previous point', async () => {
      await seedExponentialHistogramMetric({
        metricName: 'test.delta.temporality',
        aggregationTemporality: 1,
        points: [
          {
            TimeUnix: new Date(now),
            ...bucketExponentialHistogramObservations([2]),
          },
          {
            TimeUnix: nowPlus('1m'),
            ...bucketExponentialHistogramObservations([2, 4]),
          },
        ],
      });

      const results = await queryQuantile(0.5, 'test.delta.temporality');

      // The second point is already an interval distribution. Its median rank
      // ends at the top of the (1, 2] bucket, so the result is exactly 2. If it
      // were treated as cumulative, only the newly appearing 4 bucket remains.
      expect(results).toHaveLength(2);
      const firstInterval = results.find(
        result =>
          result.__hdx_time_bucket === toClickHouseISOString(new Date(now)),
      );
      const secondInterval = results.find(
        result =>
          result.__hdx_time_bucket === toClickHouseISOString(nowPlus('1m')),
      );
      expect(firstInterval?.Value).toBeCloseTo(Math.sqrt(2));
      expect(secondInterval?.Value).toBe(2);
    });

    it('ignores unspecified-temporality exponential histograms', async () => {
      const metricName = 'test.unspecified.temporality';
      await seedExponentialHistogramMetric({
        metricName,
        aggregationTemporality: 0,
        points: [
          {
            TimeUnix: new Date(now),
            ...bucketExponentialHistogramObservations([2]),
          },
          {
            TimeUnix: nowPlus('1m'),
            ...bucketExponentialHistogramObservations([2, 4]),
          },
        ],
      });

      expect(await queryQuantile(0.5, metricName)).toEqual([]);
    });

    it('sums multiple cumulative interval deltas from one series within a single chart bucket', async () => {
      const startTime = nowPlus('-1m');
      await seedExponentialHistogramMetric({
        metricName: 'test.multiple.points.same.chart.bucket',
        points: [
          {
            TimeUnix: new Date(now),
            StartTimeUnix: startTime,
            ...bucketExponentialHistogramObservations([]),
          },
          {
            TimeUnix: nowPlus('20s'),
            StartTimeUnix: startTime,
            ...bucketExponentialHistogramObservations([2]),
          },
          {
            TimeUnix: nowPlus('40s'),
            StartTimeUnix: startTime,
            ...bucketExponentialHistogramObservations([2, 4]),
          },
        ],
      });

      // The two sub-minute increases are [2] and [4]. They must be summed into
      // one minute bucket before selecting a quantile; [2, 4] has p50 = 2.
      expect(
        await queryQuantile(0.5, 'test.multiple.points.same.chart.bucket'),
      ).toEqual([
        {
          __hdx_time_bucket: toClickHouseISOString(new Date(now)),
          Value: 2,
        },
      ]);
    });

    it('sums multiple delta points from one series within a single chart bucket', async () => {
      const metricName = 'test.multiple.delta.points.same.chart.bucket';
      await seedExponentialHistogramMetric({
        metricName,
        aggregationTemporality: 1,
        points: [
          {
            TimeUnix: nowPlus('20s'),
            ...bucketExponentialHistogramObservations([2]),
          },
          {
            TimeUnix: nowPlus('40s'),
            ...bucketExponentialHistogramObservations([4]),
          },
        ],
      });

      // Both delta points fall inside the first minute bucket, so their
      // interval counts sum to [2, 4], whose median rank reaches the upper
      // boundary of the (1, 2] bucket.
      expect(await queryQuantile(0.5, metricName)).toEqual([
        {
          __hdx_time_bucket: toClickHouseISOString(new Date(now)),
          Value: 2,
        },
      ]);
    });

    it('combines cumulative and delta temporality series within the same output group', async () => {
      const metricName = 'test.mixed.temporality.group';
      const groupAttributes = { route: '/mixed' };
      await seedExponentialHistogramMetric({
        metricName,
        points: [
          {
            TimeUnix: new Date(now),
            StartTimeUnix: nowPlus('-1m'),
            ResourceAttributes: { producer: 'cumulative' },
            Attributes: { ...groupAttributes, instance: 'cumulative-a' },
            ...bucketExponentialHistogramObservations([]),
          },
          {
            TimeUnix: nowPlus('1m'),
            StartTimeUnix: nowPlus('-1m'),
            ResourceAttributes: { producer: 'cumulative' },
            Attributes: { ...groupAttributes, instance: 'cumulative-a' },
            ...bucketExponentialHistogramObservations([2]),
          },
        ],
      });
      await seedExponentialHistogramMetric({
        metricName,
        aggregationTemporality: 1,
        points: [
          {
            TimeUnix: nowPlus('1m'),
            ResourceAttributes: { producer: 'delta' },
            Attributes: { ...groupAttributes, instance: 'delta-a' },
            ...bucketExponentialHistogramObservations([4]),
          },
        ],
      });

      // The cumulative series contributes its [2] increase and the delta series
      // contributes [4] directly. After spatial aggregation, rank 1 reaches the
      // upper boundary of the first positive bucket, producing p50 = 2.
      expect(
        await queryQuantile(0.5, metricName, {
          groupBy: "Attributes['route']",
        }),
      ).toEqual([
        {
          __hdx_time_bucket: toClickHouseISOString(nowPlus('1m')),
          group: ['/mixed'],
          Value: 2,
        },
      ]);
    });

    it('combines mixed temporalities and mixed scales within the same output group', async () => {
      const metricName = 'test.mixed.temporality.and.scale.group';
      const groupAttributes = { route: '/mixed-scale-temporality' };
      await seedExponentialHistogramMetric({
        metricName,
        points: [
          {
            TimeUnix: new Date(now),
            StartTimeUnix: nowPlus('-1m'),
            Attributes: { ...groupAttributes, instance: 'cumulative-fine' },
            ...bucketExponentialHistogramObservations([], 1),
          },
          {
            TimeUnix: nowPlus('1m'),
            StartTimeUnix: nowPlus('-1m'),
            Attributes: { ...groupAttributes, instance: 'cumulative-fine' },
            ...bucketExponentialHistogramObservations([2], 1),
          },
        ],
      });
      await seedExponentialHistogramMetric({
        metricName,
        aggregationTemporality: 1,
        points: [
          {
            TimeUnix: nowPlus('1m'),
            Attributes: { ...groupAttributes, instance: 'delta-coarse' },
            ...bucketExponentialHistogramObservations([16], -1),
          },
        ],
      });

      // The cumulative scale-1 observation downscales into scale -1 bucket 0;
      // the delta observation is already in bucket 1. Their combined p50 ends
      // at bucket 0's upper boundary, which is 4.
      expect(
        await queryQuantile(0.5, metricName, {
          groupBy: "Attributes['route']",
        }),
      ).toEqual([
        {
          __hdx_time_bucket: toClickHouseISOString(nowPlus('1m')),
          group: ['/mixed-scale-temporality'],
          Value: 4,
        },
      ]);
    });

    it('normalizes different scales across independent series before combining their buckets', async () => {
      await seedExponentialHistogramMetric({
        metricName: 'test.scale.across.series',
        points: [
          {
            TimeUnix: new Date(now),
            Attributes: { instance: 'coarse' },
            ...bucketExponentialHistogramObservations([], -1),
          },
          {
            TimeUnix: nowPlus('1m'),
            Attributes: { instance: 'coarse' },
            ...bucketExponentialHistogramObservations([4], -1),
          },
        ],
      });
      await seedExponentialHistogramMetric({
        metricName: 'test.scale.across.series',
        points: [
          {
            TimeUnix: new Date(now),
            Attributes: { instance: 'fine' },
            ...bucketExponentialHistogramObservations([], 1),
          },
          {
            TimeUnix: nowPlus('1m'),
            Attributes: { instance: 'fine' },
            ...bucketExponentialHistogramObservations([4], 1),
          },
        ],
      });

      const [result] = await queryQuantile(0.5, 'test.scale.across.series');

      // Both observations normalize into scale -1 bucket 0, whose bounds are
      // (1, 4]. Their median is the bucket's geometric midpoint, 2.
      expect(result.Value).toBeCloseTo(2);
    });

    it('normalizes an unaligned multi-bucket range across multiple coarser bucket boundaries', async () => {
      const metricName = 'test.scale.unaligned.multi.bucket.range';
      const fineObservations = [
        { index: 1, count: 1 },
        { index: 2, count: 2 },
        { index: 3, count: 3 },
        { index: 4, count: 4 },
        { index: 5, count: 5 },
        { index: 6, count: 6 },
        { index: 7, count: 7 },
        { index: 8, count: 8 },
        { index: 9, count: 9 },
      ].flatMap(({ index, count }) =>
        Array.from({ length: count }, () => 2 ** ((index + 0.5) / 2)),
      );

      await seedExponentialHistogramMetric({
        metricName,
        points: [
          {
            TimeUnix: new Date(now),
            Attributes: { instance: 'coarse' },
            ...bucketExponentialHistogramObservations([], -1),
          },
          {
            TimeUnix: nowPlus('1m'),
            Attributes: { instance: 'coarse' },
            ...bucketExponentialHistogramObservations([], -1),
          },
        ],
      });
      await seedExponentialHistogramMetric({
        metricName,
        points: [
          {
            TimeUnix: new Date(now),
            Attributes: { instance: 'fine' },
            ...bucketExponentialHistogramObservations([], 1),
          },
          {
            TimeUnix: nowPlus('1m'),
            Attributes: { instance: 'fine' },
            ...bucketExponentialHistogramObservations(fineObservations, 1),
          },
        ],
      });

      const [result] = await queryQuantile(0.5, metricName);

      // Scale 1 indexes 1..9 have counts 1..9. Normalizing to scale -1 uses
      // a divisor of 4, and the unaligned offset 1 produces coarse counts
      // [1+2+3, 4+5+6+7, 8+9] = [6, 22, 17]. Rank 22.5 is therefore 75%
      // through coarse bucket index 1, whose bounds are (4, 16]. Log-linear
      // interpolation gives 4 * 4^0.75 = sqrt(128).
      expect(result.Value).toBeCloseTo(Math.sqrt(128));
    });

    it('normalizes an unaligned negative multi-bucket range across multiple coarser bucket boundaries', async () => {
      const metricName = 'test.scale.unaligned.negative.multi.bucket.range';
      const fineObservations = [
        { index: 1, count: 1 },
        { index: 2, count: 2 },
        { index: 3, count: 3 },
        { index: 4, count: 4 },
        { index: 5, count: 5 },
        { index: 6, count: 6 },
        { index: 7, count: 7 },
        { index: 8, count: 8 },
        { index: 9, count: 9 },
      ].flatMap(({ index, count }) =>
        Array.from({ length: count }, () => -(2 ** ((index + 0.5) / 2))),
      );

      await seedExponentialHistogramMetric({
        metricName,
        points: [
          {
            TimeUnix: new Date(now),
            Attributes: { instance: 'coarse' },
            ...bucketExponentialHistogramObservations([], -1),
          },
          {
            TimeUnix: nowPlus('1m'),
            Attributes: { instance: 'coarse' },
            ...bucketExponentialHistogramObservations([], -1),
          },
        ],
      });
      await seedExponentialHistogramMetric({
        metricName,
        points: [
          {
            TimeUnix: new Date(now),
            Attributes: { instance: 'fine' },
            ...bucketExponentialHistogramObservations([], 1),
          },
          {
            TimeUnix: nowPlus('1m'),
            Attributes: { instance: 'fine' },
            ...bucketExponentialHistogramObservations(fineObservations, 1),
          },
        ],
      });

      const [result] = await queryQuantile(0.5, metricName);

      // Magnitude indexes 1..9 normalize to counts [6, 22, 17] at scale -1.
      // Negative ordering reverses those to [17, 22, 6]. Rank 22.5 is 25%
      // through magnitude bucket index 1, interpolating from -16 toward -4
      // to produce -sqrt(128).
      expect(result.Value).toBeCloseTo(-Math.sqrt(128));
    });

    it('preserves internal empty buckets while normalizing a sparse fine-scale range', async () => {
      const metricName = 'test.scale.sparse.internal.empty.buckets';
      const fineObservations = [1, 9].map(index => 2 ** ((index + 0.5) / 2));

      await seedExponentialHistogramMetric({
        metricName,
        aggregationTemporality: 1,
        points: [
          {
            TimeUnix: nowPlus('1m'),
            Attributes: { instance: 'coarse' },
            ...bucketExponentialHistogramObservations([], -1),
          },
        ],
      });
      await seedExponentialHistogramMetric({
        metricName,
        aggregationTemporality: 1,
        points: [
          {
            TimeUnix: nowPlus('1m'),
            Attributes: { instance: 'fine' },
            ...bucketExponentialHistogramObservations(fineObservations, 1),
          },
        ],
      });

      const [result] = await queryQuantile(0.75, metricName);

      // Fine indexes 1 and 9 create a dense source array with seven internal
      // zeroes. At scale -1 they become coarse counts [1, 0, 1]. Rank 1.5
      // skips the empty middle bucket and lands halfway through (16, 64].
      expect(result.Value).toBeCloseTo(32);
    });

    it('normalizes a scale change within one cumulative series before calculating its delta', async () => {
      const startTime = nowPlus('-1m');
      await seedExponentialHistogramMetric({
        metricName: 'test.scale.within.series',
        points: [
          {
            TimeUnix: new Date(now),
            StartTimeUnix: startTime,
            ...bucketExponentialHistogramObservations([2], 1),
          },
          {
            TimeUnix: nowPlus('1m'),
            StartTimeUnix: startTime,
            ...bucketExponentialHistogramObservations([2, 4], 0),
          },
        ],
      });

      const [result] = await queryQuantile(0.5, 'test.scale.within.series');

      // After the scale-1 baseline is downscaled to scale 0, its 2 is removed
      // from the cumulative point and only the newly recorded 4 remains.
      expect(result.Value).toBeCloseTo(Math.sqrt(8));
    });

    it('normalizes mixed scales and an in-series scale change before aggregating a group', async () => {
      const metricName = 'test.mixed.scale.group';
      const startTime = nowPlus('-1m');
      await seedExponentialHistogramMetric({
        metricName,
        points: [
          {
            TimeUnix: new Date(now),
            StartTimeUnix: startTime,
            Attributes: { route: '/mixed-scale', instance: 'changing' },
            ...bucketExponentialHistogramObservations([2], 1),
          },
          {
            TimeUnix: nowPlus('1m'),
            StartTimeUnix: startTime,
            Attributes: { route: '/mixed-scale', instance: 'changing' },
            ...bucketExponentialHistogramObservations([2, 4], 0),
          },
        ],
      });
      await seedExponentialHistogramMetric({
        metricName,
        points: [
          {
            TimeUnix: new Date(now),
            Attributes: { route: '/mixed-scale', instance: 'coarse' },
            ...bucketExponentialHistogramObservations([], -1),
          },
          {
            TimeUnix: nowPlus('1m'),
            Attributes: { route: '/mixed-scale', instance: 'coarse' },
            ...bucketExponentialHistogramObservations([4], -1),
          },
        ],
      });

      const [result] = await queryQuantile(0.5, metricName, {
        groupBy: "Attributes['route']",
      });

      // The changing series first normalizes its scale-1 baseline and scale-0
      // cumulative point to scale -1, leaving one new 4. The coarse series adds
      // another 4. Both land in scale -1 bucket (1, 4], whose midpoint is 2.
      expect(result).toMatchObject({
        __hdx_time_bucket: toClickHouseISOString(nowPlus('1m')),
        group: ['/mixed-scale'],
      });
      expect(result.Value).toBeCloseTo(2);
    });

    it('floors negative bucket indexes when normalizing to a coarser scale', async () => {
      await seedExponentialHistogramMetric({
        metricName: 'test.negative.bucket.index',
        points: [
          {
            TimeUnix: new Date(now),
            Attributes: { instance: 'coarse' },
            ...bucketExponentialHistogramObservations([], 0),
          },
          {
            TimeUnix: nowPlus('1m'),
            Attributes: { instance: 'coarse' },
            ...bucketExponentialHistogramObservations([0.5], 0),
          },
        ],
      });
      await seedExponentialHistogramMetric({
        metricName: 'test.negative.bucket.index',
        points: [
          {
            TimeUnix: new Date(now),
            Attributes: { instance: 'fine' },
            ...bucketExponentialHistogramObservations([], 1),
          },
          {
            TimeUnix: nowPlus('1m'),
            Attributes: { instance: 'fine' },
            ...bucketExponentialHistogramObservations([0.5], 1),
          },
        ],
      });

      const [result] = await queryQuantile(0.5, 'test.negative.bucket.index');

      // Fine-scale index -3 must floor to coarse-scale index -2, not truncate
      // to -1. Scale-0 bucket -2 is (0.25, 0.5], with midpoint sqrt(0.125).
      expect(result.Value).toBeCloseTo(Math.sqrt(0.125));
    });

    it('floors negative bucket indexes for negative observations when normalizing to a coarser scale', async () => {
      const metricName = 'test.negative.side.bucket.index';
      await seedExponentialHistogramMetric({
        metricName,
        points: [
          {
            TimeUnix: new Date(now),
            Attributes: { instance: 'coarse' },
            ...bucketExponentialHistogramObservations([], 0),
          },
          {
            TimeUnix: nowPlus('1m'),
            Attributes: { instance: 'coarse' },
            ...bucketExponentialHistogramObservations([-0.5], 0),
          },
        ],
      });
      await seedExponentialHistogramMetric({
        metricName,
        points: [
          {
            TimeUnix: new Date(now),
            Attributes: { instance: 'fine' },
            ...bucketExponentialHistogramObservations([], 1),
          },
          {
            TimeUnix: nowPlus('1m'),
            Attributes: { instance: 'fine' },
            ...bucketExponentialHistogramObservations([-0.5], 1),
          },
        ],
      });

      const [result] = await queryQuantile(0.5, metricName);

      // The negative buckets downscale separately from the positive ones, so
      // fine-scale magnitude index -3 must also floor to coarse index -2.
      // Scale-0 negative bucket -2 spans [-0.5, -0.25), with logarithmic
      // midpoint -sqrt(0.125).
      expect(result.Value).toBeCloseTo(-Math.sqrt(0.125));
    });

    it('interpolates at the finest valid scale without downscaling', async () => {
      const scale = 20;
      await seedExponentialHistogramMetric({
        metricName: 'test.scale.maximum.fine.interpolation',
        aggregationTemporality: 1,
        points: [
          {
            TimeUnix: nowPlus('1m'),
            ...bucketExponentialHistogramObservations([2, 2], scale),
          },
        ],
      });

      const [result] = await queryQuantile(
        0.5,
        'test.scale.maximum.fine.interpolation',
      );

      // At scale 20, value 2 occupies index 2^20 - 1. Its midpoint is only
      // half a scale-20 logarithmic step below 2.
      const expected = 2 ** (1 - 0.5 / 2 ** scale);
      expect(result.Value).toBeCloseTo(expected);
    });

    it('normalizes across the full valid scale range without overflowing the divisor', async () => {
      const metricName = 'test.scale.full.range.normalization';
      await seedExponentialHistogramMetric({
        metricName,
        aggregationTemporality: 1,
        points: [
          {
            TimeUnix: nowPlus('1m'),
            Attributes: { instance: 'coarse' },
            ...bucketExponentialHistogramObservations([], -10),
          },
        ],
      });
      await seedExponentialHistogramMetric({
        metricName,
        aggregationTemporality: 1,
        points: [
          {
            TimeUnix: nowPlus('1m'),
            Attributes: { instance: 'fine' },
            ...bucketExponentialHistogramObservations([2, 2], 20),
          },
        ],
      });

      const [result] = await queryQuantile(0.5, metricName);

      // The scale difference is 30, so the divisor is 2^30. Fine index
      // 2^20 - 1 maps to scale -10 bucket 0, whose logarithmic midpoint is
      // 2^512. Compare relatively because the expected value is enormous.
      expect(result.Value / 2 ** 512).toBeCloseTo(1);
    });

    it('handles a cumulative bucket offset expanding toward smaller values', async () => {
      const startTime = nowPlus('-1m');
      await seedExponentialHistogramMetric({
        metricName: 'test.offset.expansion',
        points: [
          {
            TimeUnix: new Date(now),
            StartTimeUnix: startTime,
            ...bucketExponentialHistogramObservations([4]),
          },
          {
            TimeUnix: nowPlus('1m'),
            StartTimeUnix: startTime,
            ...bucketExponentialHistogramObservations([2, 4]),
          },
        ],
      });

      const [result] = await queryQuantile(0.5, 'test.offset.expansion');

      // Adding 2 expands PositiveOffset from 1 to 0. Absolute bucket indexes
      // align the old 4 correctly, leaving the new 2 as the only delta count.
      expect(result.Value).toBeCloseTo(Math.sqrt(2));
    });

    it('handles a cumulative negative-bucket offset expanding toward smaller magnitudes', async () => {
      const startTime = nowPlus('-1m');
      await seedExponentialHistogramMetric({
        metricName: 'test.negative.offset.expansion',
        points: [
          {
            TimeUnix: new Date(now),
            StartTimeUnix: startTime,
            ...bucketExponentialHistogramObservations([-4]),
          },
          {
            TimeUnix: nowPlus('1m'),
            StartTimeUnix: startTime,
            ...bucketExponentialHistogramObservations([-2, -4]),
          },
        ],
      });

      const [result] = await queryQuantile(
        0.5,
        'test.negative.offset.expansion',
      );

      // Adding -2 expands NegativeOffset from magnitude index 1 to 0. The old
      // -4 count remains aligned by absolute index, leaving -2 as the delta.
      expect(result.Value).toBeCloseTo(-Math.sqrt(2));
    });

    it('normalizes a scale change before using all counts from a known reset', async () => {
      await seedExponentialHistogramMetric({
        metricName: 'test.scale.change.with.known.reset',
        points: [
          {
            TimeUnix: new Date(now),
            StartTimeUnix: nowPlus('-1m'),
            ...bucketExponentialHistogramObservations([2, 2], 1),
          },
          {
            TimeUnix: nowPlus('1m'),
            StartTimeUnix: nowPlus('30s'),
            ...bucketExponentialHistogramObservations([4, 4], 0),
          },
        ],
      });

      const [result] = await queryQuantile(
        0.5,
        'test.scale.change.with.known.reset',
      );

      // Both points normalize to scale 0 before reset detection. The changed
      // start time then selects the complete current [4, 4] distribution.
      expect(result.Value).toBeCloseTo(Math.sqrt(8));
    });

    it('ignores other metrics, filtered attribute series, and points outside the requested range', async () => {
      await seedExponentialHistogramMetric({
        metricName: 'test.isolated.metric',
        points: [
          {
            TimeUnix: new Date(now),
            Attributes: { route: '/target' },
            ...bucketExponentialHistogramObservations([]),
          },
          {
            TimeUnix: nowPlus('1m'),
            Attributes: { route: '/target' },
            ...bucketExponentialHistogramObservations([2, 4]),
          },
          {
            TimeUnix: nowPlus('3m'),
            Attributes: { route: '/target' },
            ...bucketExponentialHistogramObservations([2, 4, 1024, 1024]),
          },
        ],
      });
      await seedExponentialHistogramMetric({
        metricName: 'test.isolated.metric',
        points: [
          {
            TimeUnix: new Date(now),
            Attributes: { route: '/noise' },
            ...bucketExponentialHistogramObservations([]),
          },
          {
            TimeUnix: nowPlus('1m'),
            Attributes: { route: '/noise' },
            ...bucketExponentialHistogramObservations([1024, 1024]),
          },
        ],
      });
      await seedExponentialHistogramMetric({
        metricName: 'test.unrelated.metric',
        points: [
          {
            TimeUnix: new Date(now),
            ...bucketExponentialHistogramObservations([]),
          },
          {
            TimeUnix: nowPlus('1m'),
            ...bucketExponentialHistogramObservations([2048, 2048]),
          },
        ],
      });

      // Only /target's in-range [2, 4] distribution is selected. The 3m point
      // may be read by the forward warm-up interval but must be filtered from
      // the final chart, while the other route and metric must not contribute.
      expect(
        await queryQuantile(0.5, 'test.isolated.metric', {
          where: "Attributes['route'] = '/target'",
        }),
      ).toEqual([
        {
          __hdx_time_bucket: toClickHouseISOString(nowPlus('1m')),
          Value: 2,
        },
      ]);
    });

    it('excludes lower-scale filtered series and unrelated metrics before choosing the normalized scale', async () => {
      const metricName = 'test.filtered.scale.isolation';
      await seedExponentialHistogramMetric({
        metricName,
        points: [
          {
            TimeUnix: new Date(now),
            Attributes: { route: '/target' },
            ...bucketExponentialHistogramObservations([], 1),
          },
          {
            TimeUnix: nowPlus('1m'),
            Attributes: { route: '/target' },
            ...bucketExponentialHistogramObservations([2, 2], 1),
          },
        ],
      });
      await seedExponentialHistogramMetric({
        metricName,
        aggregationTemporality: 1,
        points: [
          {
            TimeUnix: nowPlus('1m'),
            Attributes: { route: '/noise' },
            ...bucketExponentialHistogramObservations([2 ** 512], -10),
          },
        ],
      });
      await seedExponentialHistogramMetric({
        metricName: 'test.filtered.scale.unrelated.metric',
        aggregationTemporality: 1,
        points: [
          {
            TimeUnix: nowPlus('1m'),
            Attributes: { route: '/target' },
            ...bucketExponentialHistogramObservations([2 ** 512], -10),
          },
        ],
      });

      const [result] = await queryQuantile(0.5, metricName, {
        where: "Attributes['route'] = '/target'",
      });

      // Filtering leaves only the scale-1 target before min(Scale) is taken.
      // Its two 2s remain in scale-1 bucket (sqrt(2), 2], with midpoint 2^0.75.
      expect(result.Value).toBeCloseTo(2 ** 0.75);
    });

    it('calculates quantiles without time bucketing when granularity is omitted', async () => {
      const metricName = 'test.no.granularity';
      await seedExponentialHistogramMetric({
        metricName,
        points: [
          {
            TimeUnix: new Date(now),
            StartTimeUnix: nowPlus('-1m'),
            ...bucketExponentialHistogramObservations([]),
          },
          {
            TimeUnix: nowPlus('1m'),
            StartTimeUnix: nowPlus('-1m'),
            ...bucketExponentialHistogramObservations([4, 4]),
          },
        ],
      });

      expect(
        await queryQuantile(0.5, metricName, { granularity: null }),
      ).toEqual([
        {
          __hdx_time_bucket: toClickHouseISOString(nowPlus('1m')),
          Value: Math.sqrt(8),
        },
      ]);
    });

    it('returns an exponential-histogram quantile under a custom value alias', async () => {
      const metricName = 'test.custom.quantile.alias';
      await seedExponentialHistogramMetric({
        metricName,
        aggregationTemporality: 1,
        points: [
          {
            TimeUnix: nowPlus('1m'),
            ...bucketExponentialHistogramObservations([4, 4]),
          },
        ],
      });

      const query = await renderChartConfig(
        {
          select: [
            {
              aggFn: 'quantile',
              alias: 'P50',
              level: 0.5,
              metricName,
              metricType: MetricsDataType.ExponentialHistogram,
              valueExpression: 'Value',
            },
          ],
          from: metricSource.from,
          where: '',
          metricTables: TEST_METRIC_TABLES,
          dateRange: [new Date(now), nowPlus('2m')],
          granularity: '1 minute',
          timestampValueExpression: metricSource.timestampValueExpression,
          connection: connection.id,
        },
        metadata,
        querySettings,
      );

      expect(await queryData(query)).toEqual([
        {
          __hdx_time_bucket: toClickHouseISOString(nowPlus('1m')),
          P50: Math.sqrt(8),
        },
      ]);
    });

    it('uses one normalized scale across output groups while calculating each group independently', async () => {
      const metricName = 'test.scale.across.output.groups';
      await seedExponentialHistogramMetric({
        metricName,
        points: [
          {
            TimeUnix: new Date(now),
            Attributes: { route: '/fine' },
            ...bucketExponentialHistogramObservations([], 1),
          },
          {
            TimeUnix: nowPlus('1m'),
            Attributes: { route: '/fine' },
            ...bucketExponentialHistogramObservations([2, 2], 1),
          },
        ],
      });
      await seedExponentialHistogramMetric({
        metricName,
        points: [
          {
            TimeUnix: new Date(now),
            Attributes: { route: '/coarse' },
            ...bucketExponentialHistogramObservations([], -1),
          },
          {
            TimeUnix: nowPlus('1m'),
            Attributes: { route: '/coarse' },
            ...bucketExponentialHistogramObservations([16, 16], -1),
          },
        ],
      });

      const results = await queryQuantile(0.5, metricName, {
        groupBy: "Attributes['route']",
      });
      const fine = results.find(result => _.isEqual(result.group, ['/fine']));
      const coarse = results.find(result =>
        _.isEqual(result.group, ['/coarse']),
      );

      // The global minimum scale is -1. The fine group's 2s therefore land in
      // (1, 4] and produce midpoint 2, while the coarse group's 16s remain in
      // (4, 16] and produce midpoint 8. Counts never cross group boundaries.
      expect(results).toHaveLength(2);
      expect(fine?.Value).toBeCloseTo(2);
      expect(coarse?.Value).toBeCloseTo(8);
    });

    it('calculates each single-attribute group quantile across multiple series in that group', async () => {
      const metricName = 'test.groupby.route';
      await seedGroupedCumulativeSeries({
        metricName,
        attributes: { route: '/checkout', instance: 'checkout-a' },
        observations: [2],
      });
      await seedGroupedCumulativeSeries({
        metricName,
        attributes: { route: '/checkout', instance: 'checkout-b' },
        observations: [4],
      });
      await seedGroupedCumulativeSeries({
        metricName,
        attributes: { route: '/search', instance: 'search-a' },
        observations: [4, 4],
      });
      await seedGroupedCumulativeSeries({
        metricName,
        attributes: { route: '/search', instance: 'search-b' },
        observations: [4, 4],
      });

      const results = await queryQuantile(0.5, metricName, {
        groupBy: "Attributes['route']",
      });
      const checkout = results.find(result =>
        _.isEqual(result.group, ['/checkout']),
      );
      const search = results.find(result =>
        _.isEqual(result.group, ['/search']),
      );

      expect(results).toHaveLength(2);
      // /checkout combines one 2 and one 4 from distinct instances. Rank 1
      // reaches the upper boundary of the first bucket, so its p50 is 2.
      expect(checkout).toEqual({
        __hdx_time_bucket: toClickHouseISOString(nowPlus('1m')),
        group: ['/checkout'],
        Value: 2,
      });
      // /search combines four 4s across its two instances. Rank 2 is halfway
      // through scale-0 bucket (2, 4], producing its geometric midpoint.
      expect(search?.Value).toBeCloseTo(Math.sqrt(8));
      expect(search?.__hdx_time_bucket).toBe(
        toClickHouseISOString(nowPlus('1m')),
      );
    });

    it('keeps cumulative predecessor chains separate for groups outside metric attributes', async () => {
      const metricName = 'test.groupby.service-name';
      const startTime = nowPlus('-1m');
      await seedExponentialHistogramMetric({
        metricName,
        points: [
          {
            TimeUnix: new Date(now),
            StartTimeUnix: startTime,
            ServiceName: 'service-a',
            ...bucketExponentialHistogramObservations([]),
          },
          {
            TimeUnix: nowPlus('1m'),
            StartTimeUnix: startTime,
            ServiceName: 'service-a',
            ...bucketExponentialHistogramObservations([2]),
          },
          {
            TimeUnix: nowPlus('20s'),
            StartTimeUnix: startTime,
            ServiceName: 'service-b',
            ...bucketExponentialHistogramObservations([]),
          },
          {
            TimeUnix: nowPlus('80s'),
            StartTimeUnix: startTime,
            ServiceName: 'service-b',
            ...bucketExponentialHistogramObservations([2]),
          },
        ],
      });

      const results = await queryQuantile(0.5, metricName, {
        groupBy: 'ServiceName',
      });

      expect(results).toHaveLength(2);
      expect(results).toEqual(
        expect.arrayContaining([
          {
            __hdx_time_bucket: toClickHouseISOString(nowPlus('1m')),
            group: ['service-a'],
            Value: Math.sqrt(2),
          },
          {
            __hdx_time_bucket: toClickHouseISOString(nowPlus('1m')),
            group: ['service-b'],
            Value: Math.sqrt(2),
          },
        ]),
      );
    });

    it('calculates each composite group quantile across multiple series in that group', async () => {
      const metricName = 'test.groupby.route.method';
      await seedGroupedCumulativeSeries({
        metricName,
        attributes: { route: '/orders', method: 'GET', instance: 'get-a' },
        observations: [0],
      });
      await seedGroupedCumulativeSeries({
        metricName,
        attributes: { route: '/orders', method: 'GET', instance: 'get-b' },
        observations: [0, 2, 2],
      });
      await seedGroupedCumulativeSeries({
        metricName,
        attributes: { route: '/orders', method: 'POST', instance: 'post-a' },
        observations: [-4, -4],
      });
      await seedGroupedCumulativeSeries({
        metricName,
        attributes: { route: '/orders', method: 'POST', instance: 'post-b' },
        observations: [-4, -4],
      });

      const results = await queryQuantile(0.5, metricName, {
        groupBy: "Attributes['route'], Attributes['method']",
      });
      const get = results.find(result =>
        _.isEqual(result.group, ['/orders', 'GET']),
      );
      const post = results.find(result =>
        _.isEqual(result.group, ['/orders', 'POST']),
      );

      expect(results).toHaveLength(2);
      // GET combines two zero counts and two positive counts across its two
      // instances. Rank 2 lands at the end of the zero bucket, so p50 is zero.
      expect(get).toEqual({
        __hdx_time_bucket: toClickHouseISOString(nowPlus('1m')),
        group: ['/orders', 'GET'],
        Value: 0,
      });
      // POST combines four -4 observations across two instances. Halfway
      // through negative bucket [-4, -2) is the logarithmic value -sqrt(8).
      expect(post?.Value).toBeCloseTo(-Math.sqrt(8));
      expect(post?.__hdx_time_bucket).toBe(
        toClickHouseISOString(nowPlus('1m')),
      );
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
                "MetricName IN ('k8s.pod.cpu.utilization', 'k8s.pod.cpu.usage')",
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
        querySettings,
      );

      const res = await queryData(query);
      // Should return data from both old (k8s.pod.cpu.utilization) and new (k8s.pod.cpu.usage) metric names
      expect(res.length).toBeGreaterThan(0);
      expect(res).toMatchSnapshot();

      // Verify the SQL contains the IN-based metric name condition
      expect(query.sql).toContain('k8s.pod.cpu.usage');
      expect(query.sql).toContain('k8s.pod.cpu.utilization');
      expect(query.sql).toMatch(/MetricName IN /);
    });

    it('should handle gauge metric with metricNameSql and groupBy', async () => {
      const query = await renderChartConfig(
        {
          select: [
            {
              aggFn: 'avg',
              metricName: 'k8s.pod.cpu.utilization',
              metricNameSql:
                "MetricName IN ('k8s.pod.cpu.utilization', 'k8s.pod.cpu.usage')",
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
        querySettings,
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
        querySettings,
      );

      const res = await queryData(query);
      // Should only return data from old metric name (k8s.pod.cpu.utilization)
      expect(res).toMatchSnapshot();

      // Verify the SQL uses simple string comparison (not IN-based)
      expect(query.sql).toContain("MetricName = 'k8s.pod.cpu.utilization'");
      expect(query.sql).not.toMatch(/MetricName IN /);
    });
  });

  describe('Query settings', () => {
    it('handles the the query settings', async () => {
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
          select: [{ valueExpression: 'Body' }],
          from: logSource.from,
          where: '',
          timestampValueExpression: 'Timestamp',
          connection: connection.id,
          settings: chSql`max_result_rows = 1`,
        },
        metadata,
        [...querySettings, { setting: 'result_overflow_mode', value: 'break' }],
      );

      const res = await queryData(query);
      // ensures `result_overflow_mode = break` is applied, otherwise query would error.
      expect(res).toHaveLength(2);
      expect(res).toMatchSnapshot();
    });
  });
});
