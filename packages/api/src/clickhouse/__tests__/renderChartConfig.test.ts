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
  bulkInsertMetricsHistogram,
  bulkInsertMetricsSum,
  DEFAULT_DATABASE,
  DEFAULT_LOGS_TABLE,
  DEFAULT_METRICS_TABLE,
  getServer,
} from '@/fixtures';
import Connection from '@/models/connection';
import { Source } from '@/models/source';
import { AggregationTemporality } from '@/utils/logParser';

const TEST_METRIC_TABLES = {
  sum: DEFAULT_METRICS_TABLE.SUM,
  gauge: DEFAULT_METRICS_TABLE.GAUGE,
  histogram: DEFAULT_METRICS_TABLE.HISTOGRAM,
};

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
      const histPointsA = [
        {
          BucketCounts: [0, 0, 0],
          ExplicitBounds: [10, 30],
          TimeUnix: new Date(now),
          Count: 0,
          Sum: 0,
        },
        {
          BucketCounts: [10, 10, 10],
          ExplicitBounds: [10, 30],
          TimeUnix: new Date(now + ms('1m')),
          Count: 30,
          Sum: 550,
        },
      ].map(point => ({
        MetricName: 'test.two_timestamps_lower_bound',
        ResourceAttributes: {
          host: 'test2',
          ip: '127.0.0.1',
        },
        AggregationTemporality: 2, // Cumulative
        ...point,
      }));
      const histPointsB = [
        {
          BucketCounts: [0, 0, 0],
          ExplicitBounds: [1, 30],
          TimeUnix: new Date(now),
          Count: 0,
          Sum: 0,
        },
        {
          BucketCounts: [10, 0, 0],
          ExplicitBounds: [1, 30],
          TimeUnix: new Date(now + ms('1m')),
          Count: 10,
          Sum: 5,
        },
      ].map(point => ({
        MetricName: 'test.two_timestamps_lower_bound_inf',
        ResourceAttributes: {
          host: 'test2',
          ip: '127.0.0.1',
        },
        AggregationTemporality: 2, // Cumulative
        ...point,
      }));
      const histPointsC = [
        {
          BucketCounts: [0, 0, 0],
          ExplicitBounds: [0, 30],
          TimeUnix: new Date(now),
          Count: 0,
          Sum: 0,
        },
        {
          BucketCounts: [0, 0, 10],
          ExplicitBounds: [0, 30],
          TimeUnix: new Date(now + ms('1m')),
          Count: 10,
          Sum: 350,
        },
      ].map(point => ({
        MetricName: 'test.two_timestamps_upper_bound_inf',
        ResourceAttributes: {
          host: 'test2',
          ip: '127.0.0.1',
        },
        AggregationTemporality: 2, // Cumulative
        ...point,
      }));
      const histPointsD = [
        {
          BucketCounts: [5, 5, 5],
          ExplicitBounds: [10, 30],
          TimeUnix: new Date(now),
          Count: 15,
          Sum: 225,
        },
        {
          BucketCounts: [0, 0, 0],
          ExplicitBounds: [10, 30],
          TimeUnix: new Date(now + ms('1m')),
          Count: 0,
          Sum: 0,
        },
        {
          BucketCounts: [10, 10, 10],
          ExplicitBounds: [10, 30],
          TimeUnix: new Date(now + ms('2m')),
          Count: 30,
          Sum: 550,
        },
      ].map(point => ({
        MetricName: 'test.three_timestamps_bounded',
        ResourceAttributes: {
          host: 'test3',
          ip: '127.0.0.1',
        },
        AggregationTemporality: 2, // Cumulative
        ...point,
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
        bulkInsertMetricsHistogram([
          ...histPointsA,
          ...histPointsB,
          ...histPointsC,
          ...histPointsD,
        ]),
      ]);
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

    it('two_timestamps_bounded histogram (p50)', async () => {
      /*
        This test starts with 2 data points with bounds of [10, 30]:
          t0: [0, 0, 0]
          t1: [10, 10, 10]

        Since the AggregationTemporality is 2(cumulative), we need to calculate the delta between the two points:
          delta: [10, 10, 10] - [0, 0, 0] = [10, 10, 10]

        Total observations: 10 + 10 + 10 = 30
        Cumulative counts: [10, 20, 30]
        p50 point:
          Rank = 0.5 * 30 = 15
          This falls in the second bucket (since 10 < 15 ≤ 20)

        We need to interpolate between the lower and upper bounds of the second bucket:
          Lower bound: 10
          Upper bound: 30
          Position in bucket: (15 - 10) / (20 - 10) = 0.5
          Interpolated value: 10 + (30 - 10) * 0.5 = 10 + 10 = 20

        Thus the first point value would be 0 since it's at the start of the bounds.
        The second point value would be 20 since that is the median point value delta from the first point.
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

    it('two_timestamps_upper_bound_inf histogram (p50)', async () => {
      /*
      This test starts with 2 data points with bounds of [0, 30]:
        t0: [0, 0, 0]
        t1: [0, 0, 10]

      Since the AggregationTemporality is 2(cumulative), we need to calculate the delta between the two points:
        delta: [0, 0, 10] - [0, 0, 0] = [0, 0, 10]

      Total observations: 0 + 0 + 10 = 10
      Cumulative counts: [0, 0, 10]
      p50 point:
        Rank = 0.5 * 10 = 5
        This falls in the third bucket

      Since all observations are in the third bucket which has no upper bound (infinity):
        For the third bucket (> 30), the algorithm would return the upper bound of the previous bucket, which is 30
        Thus the value columns in res should be [0, 30]
      */
      const query = await renderChartConfig(
        {
          select: [
            {
              aggFn: 'quantile',
              level: 0.5,
              metricName: 'test.two_timestamps_upper_bound_inf',
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

    // HDX-1515: Handle counter reset in histogram metric in the same way that the counter reset
    // is handled for sum metrics.
    it.skip('three_timestamps_bounded histogram with reset (p50)', async () => {
      /*
        For the following histogram values:
          b = [10, 30]
          t0 = [5, 5, 5]
          t1 = [0, 0, 0]
          t2 = [10, 10, 10]

        The computed value at each point would be:
          t0 = 10
            cum values = [5, 10, 15]
            rank = 0.5 * 15 = 7.5

          t1 = 0
            cum values = [0, 0, 0]
            rank = 0.5 * 0 = 0

          t2 = 20
            cum values = [10, 20, 30]
            rank = 0.5 * 30 = 15
            Position in bucket: (15 - 10) / (20 - 10) = 0.5
            Interpolated value: 10 + (30 - 10) * 0.5 = 10 + 10 = 20

        Ignoring the counter reset of zeros:
          [10, 0, 20] is interpolated as [10, 10, 30]
       */
      const query = await renderChartConfig(
        {
          select: [
            {
              aggFn: 'quantile',
              level: 0.5,
              metricName: 'test.three_timestamps_bounded',
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
  });
});
