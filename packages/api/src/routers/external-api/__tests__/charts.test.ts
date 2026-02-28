import { SourceKind } from '@hyperdx/common-utils/dist/types';
import { MetricsDataType } from '@hyperdx/common-utils/dist/types';
import { ObjectId } from 'mongodb';
import request from 'supertest';

import * as config from '../../../config';
import {
  bulkInsertLogs,
  bulkInsertMetricsGauge,
  bulkInsertMetricsHistogram,
  bulkInsertMetricsSum,
  DEFAULT_DATABASE,
  DEFAULT_LOGS_TABLE,
  getLoggedInAgent,
  getServer,
} from '../../../fixtures';
import Connection from '../../../models/connection';
import { ISource, Source } from '../../../models/source';

// Default time range for tests (1 hour)
const DEFAULT_END_TIME = Date.now();
const DEFAULT_START_TIME = DEFAULT_END_TIME - 3600 * 1000;

// Helper to create standard series request payload
const createSeriesRequestPayload = (sourceId: string, overrides: any = {}) => {
  const defaults = {
    startTime: DEFAULT_START_TIME,
    endTime: DEFAULT_END_TIME,
    series: [
      {
        sourceId,
        dataSource: 'events',
        aggFn: 'count',
        where: '',
        groupBy: [],
      },
    ],
  };

  const result = {
    ...defaults,
    ...overrides,
    // Ensure series is always an array
    series: overrides.series ?? defaults.series,
  };

  // If series is explicitly provided but doesn't include sourceId, add it to each item
  if (overrides.series) {
    result.series = result.series.map((s: any) => {
      // Default sourceId but allow it to be overridden
      const seriesWithSource = { sourceId, ...s };

      // For metrics sources, ensure all required fields are set
      if (seriesWithSource.dataSource === 'metrics') {
        if (!seriesWithSource.metricDataType) {
          seriesWithSource.metricDataType = MetricsDataType.Gauge;
        }
        if (!seriesWithSource.field) {
          seriesWithSource.field = 'Value';
        }
        if (!seriesWithSource.metricName) {
          seriesWithSource.metricName = 'test.metric.gauge';
        }
      }

      return seriesWithSource;
    });
  }

  return result;
};

describe('External API v2 Charts', () => {
  const server = getServer();
  let agent: request.SuperTest<request.Test>;
  let team: any;
  let user: any;
  let connection: any;
  let logSource: ISource;
  let metricSource: ISource;

  beforeAll(async () => {
    await server.start();
  });

  beforeEach(async () => {
    const result = await getLoggedInAgent(server);
    agent = result.agent;
    team = result.team;
    user = result.user;

    connection = await Connection.create({
      team: team._id,
      name: 'Default',
      host: config.CLICKHOUSE_HOST,
      username: config.CLICKHOUSE_USER,
      password: config.CLICKHOUSE_PASSWORD,
    });

    logSource = await Source.create({
      kind: SourceKind.Log,
      team: team._id,
      from: {
        databaseName: DEFAULT_DATABASE,
        tableName: DEFAULT_LOGS_TABLE,
      },
      timestampValueExpression: 'Timestamp',
      connection: connection._id,
      name: 'Logs',
    });

    metricSource = await Source.create({
      kind: SourceKind.Metric,
      team: team._id,
      from: {
        databaseName: DEFAULT_DATABASE,
        tableName: '', // Not directly used
      },
      metricTables: {
        [MetricsDataType.Gauge.toLowerCase()]: 'otel_metrics_gauge',
        [MetricsDataType.Sum.toLowerCase()]: 'otel_metrics_sum',
        [MetricsDataType.Histogram.toLowerCase()]: 'otel_metrics_histogram',
      },
      timestampValueExpression: 'TimeUnix',
      connection: connection._id,
      name: 'Metrics',
    });

    // Insert test data
    const now = new Date(DEFAULT_END_TIME - 10000); // Ensure data is within default range
    const logsToInsert = [
      {
        ServiceName: 'test-service-2',
        Timestamp: now,
        SeverityText: 'info',
        Body: 'Test log message 1',
        Attributes: { num_attr: 10 },
      },
      {
        ServiceName: 'test-service',
        Timestamp: new Date(now.getTime() + 1000),
        SeverityText: 'info',
        Body: 'Test log message 2',
        Attributes: { num_attr: 20 },
      },
    ];
    await bulkInsertLogs(logsToInsert);

    // Insert Metric Data as Logs (for existing tests)
    const metricLogsToInsert = [
      {
        ServiceName: 'metric-test-service',
        Timestamp: now,
        SeverityText: 'metric',
        Body: JSON.stringify({
          MetricName: 'test.metric.gauge',
          Value: 15,
          ResourceAttributes: { 'service.name': 'metric-test-service' },
          Attributes: { attr1: 'value1' },
        }),
        Attributes: { metric_log_marker: true }, // ensure Attributes field is present
      },
      {
        ServiceName: 'metric-test-service',
        Timestamp: new Date(now.getTime() + 1000),
        SeverityText: 'metric',
        Body: JSON.stringify({
          MetricName: 'test.metric.gauge',
          Value: 25,
          ResourceAttributes: { 'service.name': 'metric-test-service' },
          Attributes: { attr1: 'value1' },
        }),
        Attributes: { metric_log_marker: true }, // ensure Attributes field is present
      },
    ];
    await bulkInsertLogs(metricLogsToInsert);

    // Insert actual Gauge Metric Data
    const gaugeMetricsToInsert = [
      {
        MetricName: 'test.metric.gauge',
        TimeUnix: now, // Date object
        Value: 15.0,
        ResourceAttributes: { 'service.name': 'metric-test-service' },
        Attributes: { attr1: 'value1' },
        ServiceName: 'metric-test-service', // Required by bulkInsertMetricsGauge type
      },
      {
        MetricName: 'test.metric.gauge',
        TimeUnix: new Date(now.getTime() + 1000), // Date object, 1s after the first
        Value: 25.0,
        ResourceAttributes: { 'service.name': 'metric-test-service' },
        Attributes: { attr1: 'value1' },
        ServiceName: 'metric-test-service', // Required by bulkInsertMetricsGauge type
      },
    ];
    try {
      await bulkInsertMetricsGauge(gaugeMetricsToInsert);
    } catch (chError) {
      console.error('Failed to insert gauge metrics for test:', chError);
      throw chError; // Fail fast if setup fails
    }

    // Insert Sum Metric Data
    const sumMetricsToInsert = [
      {
        MetricName: 'test.metric.sum',
        TimeUnix: now,
        Value: 100.0,
        AggregationTemporality: 1, // DELTA
        IsMonotonic: true,
        ResourceAttributes: { 'service.name': 'metric-test-service' },
        ServiceName: 'metric-test-service',
      },
      {
        MetricName: 'test.metric.sum',
        TimeUnix: new Date(now.getTime() + 1000),
        Value: 150.0,
        AggregationTemporality: 1, // DELTA
        IsMonotonic: true,
        ResourceAttributes: { 'service.name': 'metric-test-service' },
        ServiceName: 'metric-test-service',
      },
    ];
    try {
      await bulkInsertMetricsSum(sumMetricsToInsert);
    } catch (chError) {
      console.error('Failed to insert sum metrics for test:', chError);
      throw chError;
    }

    // Insert Histogram Metric Data
    const histogramMetricsToInsert = [
      {
        MetricName: 'test.metric.histogram',
        TimeUnix: now,
        BucketCounts: [5, 10, 3, 0], // 4 buckets with these counts
        ExplicitBounds: [10, 50, 100], // 3 boundaries creating 4 buckets: <10, 10-50, 50-100, >100
        ResourceAttributes: { 'service.name': 'metric-test-service' },
        ServiceName: 'metric-test-service',
        AggregationTemporality: 1, // DELTA
      },
      {
        MetricName: 'test.metric.histogram',
        TimeUnix: new Date(now.getTime() + 1000),
        BucketCounts: [3, 12, 5, 2], // 4 buckets with these counts
        ExplicitBounds: [10, 50, 100], // Same boundaries
        ResourceAttributes: { 'service.name': 'metric-test-service' },
        ServiceName: 'metric-test-service',
        AggregationTemporality: 1, // DELTA
      },
    ];
    try {
      await bulkInsertMetricsHistogram(histogramMetricsToInsert);
    } catch (chError) {
      console.error('Failed to insert histogram metrics for test:', chError);
      throw chError;
    }
  });

  afterEach(async () => {
    await server.clearDBs();
  });

  afterAll(async () => {
    await server.stop();
  });

  // Helper for authenticated requests
  const authRequest = (
    method: 'get' | 'post' | 'put' | 'delete',
    url: string,
  ) => {
    return agent[method](url).set('Authorization', `Bearer ${user?.accessKey}`);
  };

  describe('POST /api/v2/charts/series', () => {
    const BASE_URL = '/api/v2/charts/series';

    // =======================================
    // Authentication & Basic Validation Tests
    // =======================================
    it('should return 401 when user is not authenticated', async () => {
      await request(server.getHttpServer()).post(BASE_URL).expect(401);
    });

    it('should return 404 if sourceId is invalid or not found', async () => {
      // Create payload with invalid sourceId in the series
      const invalidSourceId = new ObjectId().toString();
      const payload = {
        startTime: DEFAULT_START_TIME,
        endTime: DEFAULT_END_TIME,
        series: [
          {
            sourceId: invalidSourceId,
            aggFn: 'count',
            where: '',
            groupBy: [],
          },
        ],
      };
      await authRequest('post', BASE_URL).send(payload).expect(404);
    });

    it('should return 400 if series array is missing or empty', async () => {
      // Test with empty series array
      const payload = {
        startTime: DEFAULT_START_TIME,
        endTime: DEFAULT_END_TIME,
        series: [], // Empty array
      };
      await authRequest('post', BASE_URL).send(payload).expect(400);

      // Test with missing series key
      const payloadWithoutSeries = {
        startTime: DEFAULT_START_TIME,
        endTime: DEFAULT_END_TIME,
      };
      await authRequest('post', BASE_URL)
        .send(payloadWithoutSeries)
        .expect(400);
    });

    it('should return 400 if invalid time range is provided', async () => {
      // Test with empty series array
      const payload = {
        startTime: 142415152,
        endTime: 5215152,
        series: [
          {
            sourceId: logSource.id.toString(),
            aggFn: 'count',
            where: 'SeverityText:info', // Only info logs
            groupBy: ['ServiceName'],
          },
        ],
      };
      await authRequest('post', BASE_URL).send(payload).expect(400);
    });

    it('should return 400 if series array exceeds max length (5)', async () => {
      const payload = createSeriesRequestPayload(logSource.id.toString(), {
        series: Array(6).fill({ aggFn: 'count', where: '', groupBy: [] }),
      });
      await authRequest('post', BASE_URL).send(payload).expect(400);
    });

    it('should return 400 if groupBy fields are inconsistent across series', async () => {
      const payload = createSeriesRequestPayload(logSource.id.toString(), {
        series: [
          { aggFn: 'count', where: '', groupBy: ['field1'] },
          { aggFn: 'count', where: '', groupBy: ['field2'] },
        ],
      });
      await authRequest('post', BASE_URL).send(payload).expect(400);
    });

    it('should return 400 for invalid aggFn', async () => {
      const payload = createSeriesRequestPayload(logSource.id.toString(), {
        series: [{ aggFn: 'invalid_function', where: '', groupBy: [] }],
      });
      await authRequest('post', BASE_URL).send(payload).expect(400);
    });

    // =======================================
    // Data Querying Tests (Logs as Source)
    // =======================================
    it('should return total count when where clause is empty', async () => {
      // Note: counts only info logs (2) + metric logs (2) = 4 total
      const payload = createSeriesRequestPayload(logSource.id.toString());
      const response = await authRequest('post', BASE_URL)
        .send(payload)
        .expect(200);

      expect(response.body.data).toBeInstanceOf(Array);
      expect(response.body.data).toHaveLength(1);
      expect(Number(response.body.data[0]['series_0.data'])).toEqual(4);
    });

    it('should handle lucene where clause (default)', async () => {
      const payload = createSeriesRequestPayload(logSource.id.toString(), {
        series: [
          {
            aggFn: 'count',
            where: 'SeverityText:info AND ServiceName:"test-service-2"',
            groupBy: [],
          },
        ],
      });
      const response = await authRequest('post', BASE_URL)
        .send(payload)
        .expect(200);
      expect(response.body.data).toHaveLength(1);
      expect(Number(response.body.data[0]['series_0.data'])).toEqual(1);
    });

    it('should handle sql where clause', async () => {
      const payload = createSeriesRequestPayload(logSource.id.toString(), {
        series: [
          {
            aggFn: 'count',
            where: "SeverityText = 'info' AND Body LIKE '%message 2%'",
            whereLanguage: 'sql',
            groupBy: [],
          },
        ],
      });
      const response = await authRequest('post', BASE_URL)
        .send(payload)
        .expect(200);
      expect(response.body.data).toHaveLength(1);
      expect(Number(response.body.data[0]['series_0.data'])).toEqual(1);
    });

    it('should handle lucene query errors gracefully', async () => {
      // Spy on console.error to suppress expected error output
      const consoleErrorSpy = jest
        .spyOn(console, 'error')
        .mockImplementation(() => {});

      const payload = createSeriesRequestPayload(logSource.id.toString(), {
        series: [{ aggFn: 'count', where: '(invalid query', groupBy: [] }],
      });
      const response = await authRequest('post', BASE_URL)
        .send(payload)
        .expect(500);
      expect(response.body).toHaveProperty('error');

      // Restore console.error
      consoleErrorSpy.mockRestore();
    });

    it('should handle sql query errors gracefully', async () => {
      // Spy on console.error to suppress expected error output
      const consoleErrorSpy = jest
        .spyOn(console, 'error')
        .mockImplementation(() => {});

      const payload = createSeriesRequestPayload(logSource.id.toString(), {
        series: [
          {
            aggFn: 'count',
            where: 'invalid query',
            whereLanguage: 'sql',
            groupBy: [],
          },
        ],
      });
      const response = await authRequest('post', BASE_URL)
        .send(payload)
        .expect(500);
      expect(response.body).toHaveProperty('error');

      // Restore console.error
      consoleErrorSpy.mockRestore();
    });

    it('should return data grouped by a single field', async () => {
      const payload = createSeriesRequestPayload(logSource.id.toString(), {
        series: [
          {
            aggFn: 'count',
            where: 'SeverityText:info', // Only info logs
            groupBy: ['ServiceName'],
          },
        ],
      });
      const response = await authRequest('post', BASE_URL)
        .send(payload)
        .expect(200);
      expect(response.body.data).toHaveLength(2);
      expect(response.body.data).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            group: ['test-service'],
            'series_0.data': '1',
          }),
          expect.objectContaining({
            group: ['test-service-2'],
            'series_0.data': '1',
          }),
        ]),
      );
    });

    it('should return data grouped by multiple fields', async () => {
      const payload = createSeriesRequestPayload(logSource.id.toString(), {
        series: [
          {
            aggFn: 'count',
            where: 'SeverityText:info', // Only info logs
            groupBy: ['ServiceName', 'SeverityText'],
          },
        ],
      });
      const response = await authRequest('post', BASE_URL)
        .send(payload)
        .expect(200);
      expect(response.body.data).toHaveLength(2);
      expect(response.body.data).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            group: ['test-service', 'info'],
            'series_0.data': '1',
          }),
          expect.objectContaining({
            group: ['test-service-2', 'info'],
            'series_0.data': '1',
          }),
        ]),
      );
    });

    it('should return data from multiple series (joined)', async () => {
      const payload = createSeriesRequestPayload(logSource.id.toString(), {
        series: [
          {
            dataSource: 'events',
            aggFn: 'count',
            where: 'SeverityText:info', // Series 0: info logs
            groupBy: ['ServiceName'],
          },
          {
            dataSource: 'events',
            aggFn: 'count',
            where: 'ServiceName:"test-service" AND SeverityText:info', // Series 1: count of info logs for test-service
            groupBy: ['ServiceName'],
          },
        ],
      });
      const response = await authRequest('post', BASE_URL)
        .send(payload)
        .expect(200);

      const expectedData = [
        {
          'series_0.data': '1', // test-service count
          'series_1.data': '1', // test-service count (info only)
          group: ['test-service'],
          ts_bucket: expect.any(Number),
        },
        {
          'series_0.data': '1', // test-service-2 count
          group: ['test-service-2'],
          ts_bucket: expect.any(Number),
        },
      ];

      // Check that we have at least these expected data points
      // (not checking exact array length due to data merging)
      expect(response.body.data.length).toBeGreaterThanOrEqual(1);
      expect(response.body.data).toEqual(expect.arrayContaining(expectedData));
    });

    it('should apply granularity', async () => {
      const payload = createSeriesRequestPayload(logSource.id.toString(), {
        granularity: '1s', // Force 1-second buckets
        series: [
          {
            aggFn: 'count',
            where: 'SeverityText:info',
            groupBy: ['ServiceName'],
          },
        ],
      });
      const response = await authRequest('post', BASE_URL)
        .send(payload)
        .expect(200);
      // Expect 2 separate buckets because logs are 1s apart and granularity is 1s
      expect(response.body.data).toHaveLength(2);
      response.body.data.forEach((row: any) => {
        expect(row.ts_bucket).toBeDefined();
        expect(Number(row['series_0.data'])).toEqual(1);
      });
    });

    it('should return data in column format', async () => {
      const payload = createSeriesRequestPayload(logSource.id.toString(), {
        seriesReturnType: 'column',
        series: [
          {
            aggFn: 'count',
            where: 'SeverityText:info',
            groupBy: [],
          },
        ],
      });
      const response = await authRequest('post', BASE_URL)
        .send(payload)
        .expect(200);

      expect(response.body.data).toHaveLength(1);
      expect(response.body.data[0]).toEqual(
        expect.objectContaining({
          __hdx_time_bucket: expect.any(String),
          series_0: '2',
        }),
      );
    });

    it('should return data in ratio format', async () => {
      // Series 0: count info logs (total 2)
      // Series 1: count test-service logs (total 1)
      const payload = createSeriesRequestPayload(logSource.id.toString(), {
        series: [
          { aggFn: 'count', where: 'SeverityText:info', groupBy: [] }, // series_0.data
          {
            aggFn: 'count',
            where: 'ServiceName:"test-service" AND SeverityText:info', // series_1.data (info only)
            groupBy: [],
          },
        ],
      });
      const response = await authRequest('post', BASE_URL)
        .send(payload)
        .expect(200);

      expect(response.body.data).toBeInstanceOf(Array);

      // Results can be in a single row or multiple rows due to how data is merged
      expect(response.body.data.length).toBeGreaterThanOrEqual(1);

      // Check that the total counts match what we expect
      const series0Count = response.body.data.reduce(
        (sum: number, row: any) => sum + Number(row['series_0.data'] || 0),
        0,
      );
      const series1Count = response.body.data.reduce(
        (sum: number, row: any) => sum + Number(row['series_1.data'] || 0),
        0,
      );

      expect(series0Count).toEqual(2); // All info logs
      expect(series1Count).toEqual(1); // Info logs for 'test-service'
    });

    it('should return count for metric series stored as logs', async () => {
      const payload = createSeriesRequestPayload(logSource.id.toString(), {
        series: [
          {
            dataSource: 'events',
            aggFn: 'count',
            where: 'ServiceName:"metric-test-service" AND SeverityText:metric',
            groupBy: [],
          },
        ],
      });

      const response = await authRequest('post', BASE_URL)
        .send(payload)
        .expect(200);

      expect(response.body.data).toBeInstanceOf(Array);
      expect(response.body.data).toHaveLength(1);
      expect(Number(response.body.data[0]['series_0.data'])).toEqual(2);
    });

    it('should return data for a single metric series using metric source', async () => {
      const payload = createSeriesRequestPayload(metricSource.id.toString(), {
        series: [
          {
            dataSource: 'metrics',
            aggFn: 'avg',
            metricName: 'test.metric.gauge',
            metricDataType: MetricsDataType.Gauge,
            field: 'Value',
            where: '',
            groupBy: [],
          },
        ],
      });

      const response = await authRequest('post', BASE_URL)
        .send(payload)
        .expect(200);

      // Verify we get an array with one result
      expect(response.body.data).toBeInstanceOf(Array);
      expect(response.body.data.length).toBe(1);

      // Verify required fields are present
      expect(response.body.data[0]).toHaveProperty('ts_bucket');
      expect('series_0.data' in response.body.data[0]).toBe(true);

      // Assert on the actual metric value (from the database)
      expect(Number(response.body.data[0]['series_0.data'])).toBe(25);
    });

    it('should return data for a single sum metric series using metric source', async () => {
      const payload = createSeriesRequestPayload(metricSource.id.toString(), {
        series: [
          {
            dataSource: 'metrics',
            aggFn: 'sum', // Use sum for Sum metrics
            metricName: 'test.metric.sum',
            metricDataType: MetricsDataType.Sum,
            field: 'Value',
            where: '',
            groupBy: [],
          },
        ],
      });

      const response = await authRequest('post', BASE_URL)
        .send(payload)
        .expect(200);

      // Verify we get an array with one result
      expect(response.body.data).toBeInstanceOf(Array);
      expect(response.body.data.length).toBe(1);

      expect(response.body.data[0]).toHaveProperty('ts_bucket');
      expect('series_0.data' in response.body.data[0]).toBe(true);

      expect(typeof Number(response.body.data[0]['series_0.data'])).toBe(
        'number',
      );
      expect(isNaN(Number(response.body.data[0]['series_0.data']))).toBe(false);
    });

    it('should return data for a single histogram metric series using metric source', async () => {
      const payload = createSeriesRequestPayload(metricSource.id.toString(), {
        series: [
          {
            dataSource: 'metrics',
            aggFn: 'quantile',
            level: 0.95,
            metricName: 'test.metric.histogram',
            metricDataType: MetricsDataType.Histogram,
            field: 'Value',
            where: '',
            groupBy: [],
          },
        ],
      });

      const response = await authRequest('post', BASE_URL)
        .send(payload)
        .expect(200);

      // Verify we get an array with one result
      expect(response.body.data).toBeInstanceOf(Array);
      expect(response.body.data.length).toBe(1);

      // Verify required fields are present
      expect(response.body.data[0]).toHaveProperty('ts_bucket');
      expect('series_0.data' in response.body.data[0]).toBe(true);

      expect(typeof Number(response.body.data[0]['series_0.data'])).toBe(
        'number',
      );
      expect(isNaN(Number(response.body.data[0]['series_0.data']))).toBe(false);
    });

    it('should return data for multiple series with different metric types', async () => {
      const payload = createSeriesRequestPayload(metricSource.id.toString(), {
        series: [
          {
            // Series 0: Gauge metric with avg aggregation
            dataSource: 'metrics',
            aggFn: 'avg',
            metricName: 'test.metric.gauge',
            metricDataType: MetricsDataType.Gauge,
            field: 'Value',
            where: '',
            groupBy: [],
          },
          {
            // Series 1: Sum metric with sum aggregation
            dataSource: 'metrics',
            aggFn: 'sum',
            metricName: 'test.metric.sum',
            metricDataType: MetricsDataType.Sum,
            field: 'Value',
            where: '',
            groupBy: [],
          },
          {
            // Series 2: Histogram metric with quantile aggregation
            dataSource: 'metrics',
            aggFn: 'quantile',
            level: 0.95,
            metricName: 'test.metric.histogram',
            metricDataType: MetricsDataType.Histogram,
            field: 'Value',
            where: '',
            groupBy: [],
          },
        ],
      });

      const response = await authRequest('post', BASE_URL)
        .send(payload)
        .expect(200);

      // Verify we get an array with one result (all metrics combined in one row)
      expect(response.body.data).toBeInstanceOf(Array);
      expect(response.body.data.length).toBe(1);

      // Verify all three series data points are present
      const resultRow = response.body.data[0];
      expect(resultRow).toHaveProperty('ts_bucket');
      expect('series_0.data' in resultRow).toBe(true);
      expect('series_1.data' in resultRow).toBe(true);
      expect('series_2.data' in resultRow).toBe(true);

      // Verify all values are numeric
      expect(typeof Number(resultRow['series_0.data'])).toBe('number');
      expect(typeof Number(resultRow['series_1.data'])).toBe('number');
      expect(typeof Number(resultRow['series_2.data'])).toBe('number');

      // Verify values are not NaN
      expect(isNaN(Number(resultRow['series_0.data']))).toBe(false);
      expect(isNaN(Number(resultRow['series_1.data']))).toBe(false);
      expect(isNaN(Number(resultRow['series_2.data']))).toBe(false);
    });

    it('should use field as metricName when metricName is not provided', async () => {
      // Bypass createSeriesRequestPayload to avoid auto-filling metricName
      const payload = {
        startTime: DEFAULT_START_TIME,
        endTime: DEFAULT_END_TIME,
        series: [
          {
            sourceId: metricSource.id.toString(),
            dataSource: 'metrics',
            aggFn: 'avg',
            metricDataType: MetricsDataType.Gauge,
            field: 'test.metric.gauge', // field used as metric name, no metricName
            where: '',
            groupBy: [],
          },
        ],
      };

      const response = await authRequest('post', BASE_URL)
        .send(payload)
        .expect(200);

      expect(response.body.data).toBeInstanceOf(Array);
      expect(response.body.data.length).toBe(1);
      expect(response.body.data[0]).toHaveProperty('ts_bucket');
      expect('series_0.data' in response.body.data[0]).toBe(true);
      expect(Number(response.body.data[0]['series_0.data'])).toBe(25);
    });

    it('should use field as metricName for sum metrics when metricName is not provided', async () => {
      const payload = {
        startTime: DEFAULT_START_TIME,
        endTime: DEFAULT_END_TIME,
        series: [
          {
            sourceId: metricSource.id.toString(),
            dataSource: 'metrics',
            aggFn: 'sum',
            metricDataType: MetricsDataType.Sum,
            field: 'test.metric.sum', // field used as metric name, no metricName
            where: '',
            groupBy: [],
          },
        ],
      };

      const response = await authRequest('post', BASE_URL)
        .send(payload)
        .expect(200);

      expect(response.body.data).toBeInstanceOf(Array);
      expect(response.body.data.length).toBe(1);
      expect('series_0.data' in response.body.data[0]).toBe(true);
      expect(isNaN(Number(response.body.data[0]['series_0.data']))).toBe(false);
    });

    it('should use field as metricName for histogram metrics when metricName is not provided', async () => {
      const payload = {
        startTime: DEFAULT_START_TIME,
        endTime: DEFAULT_END_TIME,
        series: [
          {
            sourceId: metricSource.id.toString(),
            dataSource: 'metrics',
            aggFn: 'quantile',
            level: 0.95,
            metricDataType: MetricsDataType.Histogram,
            field: 'test.metric.histogram', // field used as metric name, no metricName
            where: '',
            groupBy: [],
          },
        ],
      };

      const response = await authRequest('post', BASE_URL)
        .send(payload)
        .expect(200);

      expect(response.body.data).toBeInstanceOf(Array);
      expect(response.body.data.length).toBe(1);
      expect('series_0.data' in response.body.data[0]).toBe(true);
      expect(isNaN(Number(response.body.data[0]['series_0.data']))).toBe(false);
    });

    it('should use metricName over field when both are provided', async () => {
      const payload = {
        startTime: DEFAULT_START_TIME,
        endTime: DEFAULT_END_TIME,
        series: [
          {
            sourceId: metricSource.id.toString(),
            dataSource: 'metrics',
            aggFn: 'avg',
            metricDataType: MetricsDataType.Gauge,
            metricName: 'test.metric.gauge',
            field: 'Value',
            where: '',
            groupBy: [],
          },
        ],
      };

      const response = await authRequest('post', BASE_URL)
        .send(payload)
        .expect(200);

      expect(response.body.data).toBeInstanceOf(Array);
      expect(response.body.data.length).toBe(1);
      expect(response.body.data[0]).toHaveProperty('ts_bucket');
      expect('series_0.data' in response.body.data[0]).toBe(true);
      expect(Number(response.body.data[0]['series_0.data'])).toBe(25);
    });

    it('should process series from different sources', async () => {
      const payload = {
        startTime: DEFAULT_START_TIME,
        endTime: DEFAULT_END_TIME,
        series: [
          {
            sourceId: logSource.id.toString(),
            dataSource: 'events',
            aggFn: 'count',
            where: 'SeverityText:info',
            groupBy: [],
          },
          {
            sourceId: metricSource.id.toString(),
            dataSource: 'metrics',
            aggFn: 'avg',
            metricName: 'test.metric.gauge',
            metricDataType: MetricsDataType.Gauge,
            field: 'Value',
            where: '',
            groupBy: [],
          },
        ],
      };

      const response = await authRequest('post', BASE_URL)
        .send(payload)
        .expect(200);

      expect(response.body.data).toBeInstanceOf(Array);
      expect(response.body.data).toHaveLength(1);
      expect('series_0.data' in response.body.data[0]).toBe(true);
      expect('series_1.data' in response.body.data[0]).toBe(true);
    });
  });
});
