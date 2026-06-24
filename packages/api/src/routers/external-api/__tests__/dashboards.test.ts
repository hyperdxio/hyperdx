import { MetricsDataType, SourceKind } from '@hyperdx/common-utils/dist/types';
import { omit } from 'lodash';
import { ObjectId } from 'mongodb';
import request from 'supertest';

import * as config from '@/config';
import {
  DEFAULT_DATABASE,
  DEFAULT_TRACES_TABLE,
  getLoggedInAgent,
  getServer,
  makeExternalChart,
  makeExternalTile,
} from '@/fixtures';
import Alert, { AlertSource, AlertThresholdType } from '@/models/alert';
import Connection from '@/models/connection';
import Dashboard from '@/models/dashboard';
import { Source } from '@/models/source';
import Webhook, { WebhookService } from '@/models/webhook';
import {
  ExternalDashboardTile,
  ExternalDashboardTileWithId,
  MarkdownChartSeries,
  NumberChartSeries,
  TableChartSeries,
  TimeChartSeries,
} from '@/utils/zod';

// Constants
const BASE_URL = '/api/v2/dashboards';
const TEST_TAGS = ['external-api', 'test'];

/**
 * Note: These tests cover the deprecated "old" format of the dashboard endpoints,
 * which accept and return "tile.series" properties instead of "tile.config".
 * This old format is still supported by HyperDX, and is intended to closely
 * resemble the HyperDX v1 format.
 */
describe('External API v2 Dashboards - old format', () => {
  const createMockDashboard = (sourceId: string, overrides = {}) => ({
    name: 'Test External Dashboard',
    tiles: [makeExternalChart({ sourceId }), makeExternalChart({ sourceId })],
    tags: TEST_TAGS,
    savedQuery: null,
    savedQueryLanguage: null,
    savedFilterValues: [],
    ...overrides,
  });

  const createMockDashboardWithIds = (sourceId: string, overrides = {}) => ({
    name: 'Test External Dashboard with IDs',
    tiles: [
      {
        ...makeExternalChart({ sourceId }),
        id: new ObjectId().toString(),
      },
      {
        ...makeExternalChart({ sourceId }),
        id: new ObjectId().toString(),
      },
    ],
    tags: TEST_TAGS,
    filters: [],
    savedQuery: null,
    savedQueryLanguage: null,
    savedFilterValues: [],
    ...overrides,
  });

  // Test chart factory functions
  const createTimeSeriesChart = (sourceId: string) => ({
    name: 'Time Series Chart',
    x: 0,
    y: 0,
    w: 6,
    h: 3,
    id: new ObjectId().toString(),
    seriesReturnType: 'column',
    series: [
      {
        type: 'time',
        sourceId,
        aggFn: 'count',
        where: '',
        groupBy: [],
      },
    ],
  });

  const createTableChart = (sourceId: string) => ({
    name: 'Table Chart',
    x: 6,
    y: 0,
    w: 6,
    h: 3,
    id: new ObjectId().toString(),
    seriesReturnType: 'column',
    series: [
      {
        type: 'table',
        sourceId,
        aggFn: 'count',
        where: '',
        groupBy: [],
        sortOrder: 'desc',
      },
    ],
  });

  const createNumberChart = (sourceId: string) => ({
    name: 'Number Chart',
    x: 0,
    y: 3,
    w: 3,
    h: 3,
    id: new ObjectId().toString(),
    seriesReturnType: 'column',
    series: [
      {
        type: 'number',
        sourceId,
        aggFn: 'count',
        where: '',
      },
    ],
  });

  const createMarkdownChart = () => ({
    name: 'Markdown Chart',
    x: 3,
    y: 3,
    w: 3,
    h: 3,
    id: new ObjectId().toString(),
    seriesReturnType: 'column',
    series: [
      {
        type: 'markdown',
        content: '# Test Markdown\nThis is a test',
      },
    ],
  });

  const server = getServer();
  let agent, team, user, traceSource, metricSource;

  beforeAll(async () => {
    await server.start();
  });

  beforeEach(async () => {
    // Setup authenticated agent for each test
    const result = await getLoggedInAgent(server);
    agent = result.agent;
    team = result.team;
    user = result.user;

    const connection = await Connection.create({
      team: team._id,
      name: 'Default',
      host: config.CLICKHOUSE_HOST,
      username: config.CLICKHOUSE_USER,
      password: config.CLICKHOUSE_PASSWORD,
    });

    traceSource = await Source.create({
      kind: SourceKind.Trace,
      team: team._id,
      from: {
        databaseName: DEFAULT_DATABASE,
        tableName: DEFAULT_TRACES_TABLE,
      },
      timestampValueExpression: 'Timestamp',
      connection: connection._id,
      name: 'Traces',
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
  });

  afterEach(async () => {
    await server.clearDBs();
  });

  afterAll(async () => {
    await server.stop();
  });

  // Helper to create a dashboard in the database
  const createTestDashboard = async (dashboardData = {}) => {
    return new Dashboard({
      name: 'Test Dashboard',
      tiles: [],
      team: team._id,
      ...dashboardData,
    }).save();
  };

  // Helper to make authenticated requests
  const authRequest = (method, url) => {
    return agent[method](url).set('Authorization', `Bearer ${user?.accessKey}`);
  };

  describe('Response Format', () => {
    it('should return responses in the expected (new) format when creating the dashboard in the old format', async () => {
      // Create a dashboard with known values for testing
      const testDashboard = {
        name: 'Format Test Dashboard',
        tiles: [
          createTimeSeriesChart(traceSource._id.toString()),
          createNumberChart(traceSource._id.toString()),
        ],
        tags: ['format-test'],
      };

      // Create the dashboard
      const createResponse = await authRequest('post', BASE_URL)
        .send(testDashboard)
        .expect(200);

      // Verify full response structure
      expect(createResponse.headers['content-type']).toMatch(
        /application\/json/,
      );
      expect(createResponse.body).toEqual({
        data: {
          id: expect.any(String),
          name: 'Format Test Dashboard',
          tiles: [
            {
              id: expect.any(String),
              name: 'Time Series Chart',
              x: 0,
              y: 0,
              w: 6,
              h: 3,
              config: {
                displayType: 'line',
                sourceId: traceSource._id.toString(),
                select: [
                  {
                    aggFn: 'count',
                    where: '',
                    whereLanguage: 'lucene',
                    valueExpression: '',
                  },
                ],
                asRatio: false,
                fillNulls: true,
              },
            },
            {
              id: expect.any(String),
              name: 'Number Chart',
              x: 0,
              y: 3,
              w: 3,
              h: 3,
              config: {
                displayType: 'number',
                sourceId: traceSource._id.toString(),
                select: [
                  {
                    aggFn: 'count',
                    where: '',
                    whereLanguage: 'lucene',
                    valueExpression: '',
                  },
                ],
              },
            },
          ],
          tags: ['format-test'],
          filters: [],
          savedQuery: null,
          savedQueryLanguage: null,
          savedFilterValues: [],
        },
      });

      // Get the dashboard to verify consistent format
      const dashboardId = createResponse.body.data.id;
      const getResponse = await authRequest(
        'get',
        `${BASE_URL}/${dashboardId}`,
      ).expect(200);

      // Verify get response has same structure
      expect(getResponse.headers['content-type']).toMatch(/application\/json/);
      expect(getResponse.body).toEqual({
        data: createResponse.body.data,
      });

      // List endpoint format
      const listResponse = await authRequest('get', BASE_URL).expect(200);

      expect(listResponse.headers['content-type']).toMatch(/application\/json/);
      expect(listResponse.body).toHaveProperty('data');
      expect(Array.isArray(listResponse.body.data)).toBe(true);

      // Delete response format
      const deleteResponse = await authRequest(
        'delete',
        `${BASE_URL}/${dashboardId}`,
      ).expect(200);

      expect(deleteResponse.body).toEqual({});
    });
  });

  describe('GET /', () => {
    it('should return all dashboards', async () => {
      // Create test dashboards
      await createTestDashboard({ name: 'Test Dashboard 1' });
      await createTestDashboard({ name: 'Test Dashboard 2' });

      const response = await authRequest('get', BASE_URL).expect(200);

      expect(response.body.data).toHaveLength(2);
      expect(response.body.data.map(d => d.name)).toContain('Test Dashboard 1');
      expect(response.body.data.map(d => d.name)).toContain('Test Dashboard 2');
      response.body.data.forEach((d: { filters: unknown }) => {
        expect(d).toHaveProperty('filters');
        expect(Array.isArray(d.filters)).toBe(true);
      });
    });

    it('should return empty array when no dashboards exist', async () => {
      const response = await authRequest('get', BASE_URL).expect(200);
      expect(response.body.data).toHaveLength(0);
    });
  });

  describe('POST /', () => {
    it('should create a new dashboard', async () => {
      const mockDashboard = createMockDashboard(traceSource._id.toString());

      const response = await authRequest('post', BASE_URL)
        .send(mockDashboard)
        .expect(200);

      expect(response.body.data).toMatchObject({
        name: mockDashboard.name,
        tiles: expect.arrayContaining([
          expect.objectContaining({ name: 'Test Chart' }),
          expect.objectContaining({ name: 'Test Chart' }),
        ]),
        tags: mockDashboard.tags,
      });
      expect(response.body.data).toHaveProperty('filters');
      expect(response.body.data.filters).toEqual([]);

      // Verify dashboard was created in database
      const dashboards = await Dashboard.find({}).lean();
      expect(dashboards).toHaveLength(1);
      expect(dashboards[0].name).toBe(mockDashboard.name);
      expect(dashboards[0].tiles).toHaveLength(2);
    });

    it('should create a dashboard with saved query defaults', async () => {
      const mockDashboard = createMockDashboard(traceSource._id.toString(), {
        savedQuery: "service.name = 'api'",
        savedQueryLanguage: 'sql',
        savedFilterValues: [
          {
            type: 'sql',
            condition: "ServiceName IN ('hdx-oss-dev-api')",
          },
        ],
      });

      const response = await authRequest('post', BASE_URL)
        .send(mockDashboard)
        .expect(200);

      expect(response.body.data.savedQuery).toBe("service.name = 'api'");
      expect(response.body.data.savedQueryLanguage).toBe('sql');
      expect(response.body.data.savedFilterValues).toEqual([
        {
          type: 'sql',
          condition: "ServiceName IN ('hdx-oss-dev-api')",
        },
      ]);

      const dashboardInDb = await Dashboard.findById(
        response.body.data.id,
      ).lean();
      expect(dashboardInDb?.savedQuery).toBe("service.name = 'api'");
      expect(dashboardInDb?.savedQueryLanguage).toBe('sql');
      expect(dashboardInDb?.savedFilterValues).toEqual([
        {
          type: 'sql',
          condition: "ServiceName IN ('hdx-oss-dev-api')",
        },
      ]);
    });

    it('should default savedQueryLanguage to lucene when savedQuery is provided without a language', async () => {
      const mockDashboard = omit(
        createMockDashboard(traceSource._id.toString(), {
          savedQuery: "service.name = 'api'",
        }),
        'savedQueryLanguage',
      );

      const response = await authRequest('post', BASE_URL)
        .send(mockDashboard)
        .expect(200);

      expect(response.body.data.savedQuery).toBe("service.name = 'api'");
      expect(response.body.data.savedQueryLanguage).toBe('lucene');

      const dashboardInDb = await Dashboard.findById(
        response.body.data.id,
      ).lean();
      expect(dashboardInDb?.savedQueryLanguage).toBe('lucene');
    });

    it('should return 400 when savedQueryLanguage is null and savedQuery is provided', async () => {
      const mockDashboard = createMockDashboard(traceSource._id.toString(), {
        savedQuery: "service.name = 'api'",
        savedQueryLanguage: null,
      });

      const response = await authRequest('post', BASE_URL)
        .send(mockDashboard)
        .expect(400);

      expect(response.body.message).toContain(
        'savedQueryLanguage cannot be null when savedQuery is provided',
      );
    });

    it('can create all chart types', async () => {
      const dashboardWithAllCharts = {
        name: 'Test Dashboard with All Chart Types',
        tiles: [
          createTimeSeriesChart(traceSource._id.toString()),
          createTableChart(traceSource._id.toString()),
          createNumberChart(traceSource._id.toString()),
          createMarkdownChart(),
        ],
        tags: ['test', 'chart-types'],
      };

      const response = await authRequest('post', BASE_URL)
        .send(dashboardWithAllCharts)
        .expect(200);

      const { id } = response.body.data;
      expect(response.body.data).toHaveProperty('id');
      expect(response.body.data.tiles.length).toBe(4);

      // Verify by retrieving the dashboard
      const retrieveResponse = await authRequest('get', `${BASE_URL}/${id}`);

      expect(retrieveResponse.status).toBe(200);
      expect(retrieveResponse.body.data.tiles.length).toBe(4);
      expect(retrieveResponse.body.data.tags).toEqual(['test', 'chart-types']);
    });

    it('can create all supported chart types and all supported fields on each chart type', async () => {
      // Arrange
      const lineChart = {
        name: 'Line Chart',
        x: 0,
        y: 0,
        w: 6,
        h: 3,
        asRatio: true,
        series: [
          {
            type: 'time',
            sourceId: traceSource._id.toString(),
            aggFn: 'quantile',
            level: 0.95,
            field: 'Duration',
            alias: '95th Percentile Duration',
            where: "env = 'production'",
            whereLanguage: 'sql',
            groupBy: ['service.name', 'StatusCode'],
            numberFormat: {
              output: 'time',
              factor: 0.001,
              unit: 'ms',
            },
            displayType: 'line',
          } satisfies TimeChartSeries,
          {
            type: 'time',
            sourceId: traceSource._id.toString(),
            aggFn: 'quantile',
            level: 0.99,
            field: 'Duration',
            alias: '99th Percentile Duration',
            where: 'env:production',
            whereLanguage: 'lucene',
            groupBy: ['service.name', 'StatusCode'],
            numberFormat: {
              output: 'time',
              factor: 0.001,
              unit: 'ms',
            },
            displayType: 'line',
          } satisfies TimeChartSeries,
        ],
      };

      const barChart = {
        name: 'Bar Chart',
        x: 6,
        y: 0,
        w: 6,
        h: 3,
        asRatio: false,
        series: [
          {
            type: 'time',
            sourceId: metricSource._id.toString(),
            aggFn: 'quantile',
            level: 0.95,
            field: '',
            metricName: 'ClickHouseAsyncMetrics_BlockWriteBytes_ram1',
            metricDataType: MetricsDataType.Gauge,
            alias: '95th Percentile Duration',
            where: "env = 'production'",
            whereLanguage: 'sql',
            groupBy: [],
            numberFormat: {
              output: 'byte',
              decimalBytes: true,
              mantissa: 0,
            },
            displayType: 'stacked_bar',
          } satisfies TimeChartSeries,
        ],
      };

      const tableChart = {
        name: 'Table Chart',
        x: 12,
        y: 0,
        w: 6,
        h: 3,
        asRatio: false,
        series: [
          {
            type: 'table',
            sourceId: traceSource._id.toString(),
            aggFn: 'quantile',
            level: 0.5,
            field: 'Duration',
            alias: 'Median Duration',
            where: "env = 'production'",
            whereLanguage: 'sql',
            groupBy: ['service.name'],
            sortOrder: 'desc',
            numberFormat: {
              output: 'percent',
              mantissa: 2,
              thousandSeparated: true,
              average: true,
            },
          } satisfies TableChartSeries,
          {
            type: 'table',
            sourceId: traceSource._id.toString(),
            aggFn: 'quantile',
            level: 0.99,
            field: 'Duration',
            alias: '99th Percentile Duration',
            where: "env = 'production'",
            whereLanguage: 'sql',
            groupBy: ['service.name'],
            sortOrder: 'desc',
            numberFormat: {
              output: 'percent',
              mantissa: 2,
              thousandSeparated: true,
              average: true,
            },
          } satisfies TableChartSeries,
        ],
      };

      const numberChart = {
        name: 'Number Chart',
        x: 18,
        y: 0,
        w: 6,
        h: 3,
        asRatio: false,
        series: [
          {
            type: 'number',
            sourceId: traceSource._id.toString(),
            aggFn: 'quantile',
            level: 0.5,
            field: 'Duration',
            alias: '50th Percentile Duration',
            where: "env = 'production'",
            whereLanguage: 'sql',
            numberFormat: {
              output: 'percent',
              mantissa: 2,
              thousandSeparated: true,
              average: true,
            },
          } satisfies NumberChartSeries,
        ],
      };

      const markdownChart = {
        name: 'Markdown Chart',
        x: 0,
        y: 3,
        w: 6,
        h: 3,
        asRatio: false,
        series: [
          {
            type: 'markdown',
            content: '# Markdown Content',
          } satisfies MarkdownChartSeries,
        ],
      };

      // Act
      const response = await authRequest('post', BASE_URL)
        .send({
          name: 'Dashboard with All Chart Types',
          tiles: [lineChart, barChart, tableChart, numberChart, markdownChart],
          tags: ['round-trip-test'],
        })
        .expect(200);

      // Expected responses
      const lineChartExpected: ExternalDashboardTile = {
        name: 'Line Chart',
        x: 0,
        y: 0,
        w: 6,
        h: 3,
        config: {
          displayType: 'line',
          asRatio: true,
          fillNulls: true,
          sourceId: traceSource._id.toString(),
          numberFormat: {
            output: 'time',
            factor: 0.001,
            unit: 'ms',
          },
          groupBy: 'service.name,StatusCode',
          select: [
            {
              aggFn: 'quantile',
              level: 0.95,
              valueExpression: 'Duration',
              alias: '95th Percentile Duration',
              where: "env = 'production'",
              whereLanguage: 'sql',
            },
            {
              aggFn: 'quantile',
              level: 0.99,
              valueExpression: 'Duration',
              alias: '99th Percentile Duration',
              where: 'env:production',
              whereLanguage: 'lucene',
            },
          ],
        },
      };

      const barChartExpected: ExternalDashboardTile = {
        name: 'Bar Chart',
        x: 6,
        y: 0,
        w: 6,
        h: 3,
        config: {
          displayType: 'stacked_bar',
          asRatio: false,
          fillNulls: true,
          sourceId: metricSource._id.toString(),
          numberFormat: {
            output: 'byte',
            decimalBytes: true,
            mantissa: 0,
          },
          select: [
            {
              aggFn: 'quantile',
              level: 0.95,
              valueExpression: '',
              metricName: 'ClickHouseAsyncMetrics_BlockWriteBytes_ram1',
              metricType: MetricsDataType.Gauge,
              alias: '95th Percentile Duration',
              where: "env = 'production'",
              whereLanguage: 'sql',
            },
          ],
        },
      };

      const tableChartExpected: ExternalDashboardTile = {
        name: 'Table Chart',
        x: 12,
        y: 0,
        w: 6,
        h: 3,
        config: {
          displayType: 'table',
          asRatio: false,
          sourceId: traceSource._id.toString(),
          select: [
            {
              aggFn: 'quantile',
              level: 0.5,
              valueExpression: 'Duration',
              alias: 'Median Duration',
              where: "env = 'production'",
              whereLanguage: 'sql',
            },
            {
              aggFn: 'quantile',
              level: 0.99,
              valueExpression: 'Duration',
              alias: '99th Percentile Duration',
              where: "env = 'production'",
              whereLanguage: 'sql',
            },
          ],
          groupBy: 'service.name',
          numberFormat: {
            output: 'percent',
            mantissa: 2,
            thousandSeparated: true,
            average: true,
          },
        },
      };

      const numberChartExpected: ExternalDashboardTile = {
        name: 'Number Chart',
        x: 18,
        y: 0,
        w: 6,
        h: 3,
        config: {
          displayType: 'number',
          sourceId: traceSource._id.toString(),
          select: [
            {
              aggFn: 'quantile',
              level: 0.5,
              valueExpression: 'Duration',
              alias: '50th Percentile Duration',
              where: "env = 'production'",
              whereLanguage: 'sql',
            },
          ],
          numberFormat: {
            output: 'percent',
            mantissa: 2,
            thousandSeparated: true,
            average: true,
          },
        },
      };

      const markdownChartExpected: ExternalDashboardTile = {
        name: 'Markdown Chart',
        x: 0,
        y: 3,
        w: 6,
        h: 3,
        config: {
          displayType: 'markdown',
          markdown: '# Markdown Content',
        },
      };

      // Assert response matches input (ignoring generated IDs)
      expect(omit(response.body.data.tiles[0], ['id'])).toEqual(
        lineChartExpected,
      );
      expect(omit(response.body.data.tiles[1], ['id'])).toEqual(
        barChartExpected,
      );
      expect(omit(response.body.data.tiles[2], ['id'])).toEqual(
        tableChartExpected,
      );
      expect(omit(response.body.data.tiles[3], ['id'])).toEqual(
        numberChartExpected,
      );
      expect(omit(response.body.data.tiles[4], ['id'])).toEqual(
        markdownChartExpected,
      );
    });

    it('should return 400 when source IDs do not exist', async () => {
      const nonExistentSourceId = new ObjectId().toString();
      const mockDashboard = createMockDashboard(nonExistentSourceId);

      const response = await authRequest('post', BASE_URL)
        .send(mockDashboard)
        .expect(400);

      expect(response.body).toEqual({
        message: `Could not find the following source IDs: ${nonExistentSourceId}`,
      });
    });

    it('should create a dashboard with filters', async () => {
      const dashboardPayload = {
        name: 'Dashboard with Filters',
        tiles: [makeExternalChart({ sourceId: traceSource._id.toString() })],
        tags: TEST_TAGS,
        filters: [
          {
            type: 'QUERY_EXPRESSION' as const,
            name: 'Environment',
            expression: 'environment',
            sourceId: traceSource._id.toString(),
          },
          {
            type: 'QUERY_EXPRESSION' as const,
            name: 'Service Filter',
            expression: 'service_name',
            sourceId: traceSource._id.toString(),
            sourceMetricType: undefined,
            // Scope to a single source (the common case for mixed-source
            // dashboards) — exercises the array round-trip.
            appliesToSourceIds: [traceSource._id.toString()],
          },
          {
            type: 'QUERY_EXPRESSION' as const,
            name: 'Region (Filtered)',
            expression: 'region',
            sourceId: traceSource._id.toString(),
            where: "environment = 'production'",
            whereLanguage: 'sql' as const,
            // Scope to multiple sources to exercise multi-entry arrays.
            appliesToSourceIds: [
              traceSource._id.toString(),
              metricSource._id.toString(),
            ],
          },
        ],
      };

      const response = await authRequest('post', BASE_URL)
        .send(dashboardPayload)
        .expect(200);

      expect(response.body.data.filters).toHaveLength(3);
      response.body.data.filters.forEach(
        (f: {
          id: string;
          name: string;
          expression: string;
          sourceId: string;
          type: string;
        }) => {
          expect(f).toHaveProperty('id');
          expect(typeof f.id).toBe('string');
          expect(f.id.length).toBeGreaterThan(0);
          expect(f).toMatchObject({
            type: 'QUERY_EXPRESSION',
            name: expect.any(String),
            expression: expect.any(String),
            sourceId: traceSource._id.toString(),
          });
        },
      );
      expect(response.body.data.filters[0].name).toBe('Environment');
      expect(response.body.data.filters[0].expression).toBe('environment');
      // Filter 0 omitted appliesToSourceIds (broadcast-to-all) — must NOT be
      // materialized as an empty array on read; the field stays absent so
      // the default semantics survive a save/load round-trip.
      expect(response.body.data.filters[0].appliesToSourceIds).toBeUndefined();
      expect(response.body.data.filters[1].name).toBe('Service Filter');
      expect(response.body.data.filters[1].expression).toBe('service_name');
      expect(response.body.data.filters[1].appliesToSourceIds).toEqual([
        traceSource._id.toString(),
      ]);
      expect(response.body.data.filters[2].name).toBe('Region (Filtered)');
      expect(response.body.data.filters[2].expression).toBe('region');
      expect(response.body.data.filters[2].where).toBe(
        "environment = 'production'",
      );
      expect(response.body.data.filters[2].whereLanguage).toBe('sql');
      expect(response.body.data.filters[2].appliesToSourceIds).toEqual([
        traceSource._id.toString(),
        metricSource._id.toString(),
      ]);

      const getResponse = await authRequest(
        'get',
        `${BASE_URL}/${response.body.data.id}`,
      ).expect(200);
      expect(getResponse.body.data.filters).toHaveLength(3);
      expect(getResponse.body.data.filters).toEqual(response.body.data.filters);
    });

    it('should return 400 when filter source ID does not exist', async () => {
      const nonExistentSourceId = new ObjectId().toString();
      const dashboardPayload = {
        name: 'Dashboard with Bad Filter Source',
        tiles: [makeExternalChart({ sourceId: traceSource._id.toString() })],
        tags: TEST_TAGS,
        filters: [
          {
            type: 'QUERY_EXPRESSION' as const,
            name: 'Bad Source Filter',
            expression: 'environment',
            sourceId: nonExistentSourceId,
          },
        ],
      };

      const response = await authRequest('post', BASE_URL)
        .send(dashboardPayload)
        .expect(400);

      expect(response.body).toEqual({
        message: `Could not find the following source IDs: ${nonExistentSourceId}`,
      });
    });

    it('should return 400 when create filter includes id', async () => {
      const dashboardPayload = {
        name: 'Dashboard with Invalid Filter ID',
        tiles: [makeExternalChart({ sourceId: traceSource._id.toString() })],
        tags: TEST_TAGS,
        filters: [
          {
            id: new ObjectId().toString(),
            type: 'QUERY_EXPRESSION' as const,
            name: 'Filter with ID',
            expression: 'environment',
            sourceId: traceSource._id.toString(),
          },
        ],
      };

      await authRequest('post', BASE_URL).send(dashboardPayload).expect(400);
    });
  });

  describe('PUT /:id', () => {
    it('should update an existing dashboard', async () => {
      const dashboard = await createTestDashboard();
      const updatedDashboard = createMockDashboardWithIds(
        traceSource._id.toString(),
        {
          name: 'Updated Dashboard Name',
        },
      );

      const response = await authRequest('put', `${BASE_URL}/${dashboard._id}`)
        .send(updatedDashboard)
        .expect(200);

      expect(response.body.data).toMatchObject({
        id: dashboard._id.toString(),
        name: 'Updated Dashboard Name',
        tiles: expect.arrayContaining([
          expect.objectContaining({ name: 'Test Chart' }),
          expect.objectContaining({ name: 'Test Chart' }),
        ]),
      });
      expect(response.body.data).toHaveProperty('filters');
      expect(Array.isArray(response.body.data.filters)).toBe(true);

      // Verify dashboard was updated in database
      const updatedDashboardInDb = await Dashboard.findById(
        dashboard._id,
      ).lean();
      expect(updatedDashboardInDb?.name).toBe('Updated Dashboard Name');
      expect(updatedDashboardInDb?.tiles).toHaveLength(2);
    });

    it('should update and clear saved query defaults', async () => {
      const dashboard = await createTestDashboard({
        savedQuery: 'service:api',
        savedQueryLanguage: 'lucene',
        savedFilterValues: [
          {
            type: 'lucene',
            condition: 'env:prod',
          },
        ],
      });
      const updatedDashboard = createMockDashboardWithIds(
        traceSource._id.toString(),
      );

      const response = await authRequest('put', `${BASE_URL}/${dashboard._id}`)
        .send(updatedDashboard)
        .expect(200);

      expect(response.body.data.savedQuery).toBeNull();
      expect(response.body.data.savedQueryLanguage).toBeNull();
      expect(response.body.data.savedFilterValues).toEqual([]);

      const updatedDashboardInDb = await Dashboard.findById(
        dashboard._id,
      ).lean();
      expect(updatedDashboardInDb?.savedQuery).toBeNull();
      expect(updatedDashboardInDb?.savedQueryLanguage).toBeNull();
      expect(updatedDashboardInDb?.savedFilterValues).toEqual([]);
    });

    it('should return 400 when savedQueryLanguage is null and savedQuery is provided on update', async () => {
      const dashboard = await createTestDashboard();
      const updatedDashboard = createMockDashboardWithIds(
        traceSource._id.toString(),
        {
          savedQuery: "service.name = 'api'",
          savedQueryLanguage: null,
        },
      );

      const response = await authRequest('put', `${BASE_URL}/${dashboard._id}`)
        .send(updatedDashboard)
        .expect(400);

      expect(response.body.message).toContain(
        'savedQueryLanguage cannot be null when savedQuery is provided',
      );
    });

    it('should update dashboard filters when provided', async () => {
      const dashboard = await createTestDashboard();
      const filterId1 = new ObjectId().toString();
      const filterId2 = new ObjectId().toString();
      const updatedPayload = createMockDashboardWithIds(
        traceSource._id.toString(),
        {
          name: 'Dashboard with Filters',
          filters: [
            {
              id: filterId1,
              type: 'QUERY_EXPRESSION' as const,
              name: 'Updated Filter 1',
              expression: 'environment',
              sourceId: traceSource._id.toString(),
              // Broadcast filter: appliesToSourceIds intentionally omitted.
            },
            {
              id: filterId2,
              type: 'QUERY_EXPRESSION' as const,
              name: 'Updated Filter 2',
              expression: 'service_name',
              sourceId: traceSource._id.toString(),
              // Multi-source scope to exercise array round-trip on PUT.
              appliesToSourceIds: [
                traceSource._id.toString(),
                metricSource._id.toString(),
              ],
            },
          ],
        },
      );

      const response = await authRequest('put', `${BASE_URL}/${dashboard._id}`)
        .send(updatedPayload)
        .expect(200);

      expect(response.body.data.filters).toHaveLength(2);
      expect(response.body.data.filters[0]).toMatchObject({
        id: expect.any(String),
        type: 'QUERY_EXPRESSION',
        name: 'Updated Filter 1',
        expression: 'environment',
        sourceId: traceSource._id.toString(),
      });
      // Broadcast filter must stay broadcast on read — the field must not
      // be materialized into an empty array by save/load.
      expect(response.body.data.filters[0].appliesToSourceIds).toBeUndefined();
      expect(response.body.data.filters[1]).toMatchObject({
        id: expect.any(String),
        type: 'QUERY_EXPRESSION',
        name: 'Updated Filter 2',
        expression: 'service_name',
        sourceId: traceSource._id.toString(),
      });
      expect(response.body.data.filters[1].appliesToSourceIds).toEqual([
        traceSource._id.toString(),
        metricSource._id.toString(),
      ]);

      const getResponse = await authRequest(
        'get',
        `${BASE_URL}/${dashboard._id}`,
      ).expect(200);
      expect(getResponse.body.data.filters).toEqual(response.body.data.filters);
    });

    it('should preserve existing dashboard filters when filters are not provided', async () => {
      const existingFilterId1 = new ObjectId().toString();
      const existingFilterId2 = new ObjectId().toString();
      const existingFilters = [
        {
          id: existingFilterId1,
          type: 'QUERY_EXPRESSION' as const,
          name: 'Existing Filter 1',
          expression: 'environment',
          sourceId: traceSource._id.toString(),
          // Stored with a scope — a no-filters PUT must preserve it intact.
          appliesToSourceIds: [traceSource._id.toString()],
        },
        {
          id: existingFilterId2,
          type: 'QUERY_EXPRESSION' as const,
          name: 'Existing Filter 2',
          expression: 'service_name',
          sourceId: traceSource._id.toString(),
        },
      ];
      const storedFilters = existingFilters.map(({ sourceId, ...filter }) => ({
        ...filter,
        source: sourceId,
      }));
      const dashboard = await createTestDashboard({
        filters: storedFilters,
      });
      const updatedPayload = createMockDashboardWithIds(
        traceSource._id.toString(),
        {
          name: 'Dashboard Name Updated Without Filters',
        },
      );

      const response = await authRequest('put', `${BASE_URL}/${dashboard._id}`)
        .send(omit(updatedPayload, 'filters'))
        .expect(200);

      expect(response.body.data.name).toBe(
        'Dashboard Name Updated Without Filters',
      );
      expect(response.body.data.filters).toHaveLength(2);
      expect(response.body.data.filters[0]).toMatchObject(existingFilters[0]);
      expect(response.body.data.filters[1]).toMatchObject(existingFilters[1]);

      const getResponse = await authRequest(
        'get',
        `${BASE_URL}/${dashboard._id}`,
      ).expect(200);
      expect(getResponse.body.data.filters).toHaveLength(2);
      expect(getResponse.body.data.filters[0]).toMatchObject(
        existingFilters[0],
      );
      expect(getResponse.body.data.filters[1]).toMatchObject(
        existingFilters[1],
      );
    });

    it('should clear existing dashboard filters when provided an empty filters array', async () => {
      const existingFilterId1 = new ObjectId().toString();
      const existingFilterId2 = new ObjectId().toString();
      const existingFilters = [
        {
          id: existingFilterId1,
          type: 'QUERY_EXPRESSION' as const,
          name: 'Existing Filter 1',
          expression: 'environment',
          sourceId: traceSource._id.toString(),
        },
        {
          id: existingFilterId2,
          type: 'QUERY_EXPRESSION' as const,
          name: 'Existing Filter 2',
          expression: 'service_name',
          sourceId: traceSource._id.toString(),
        },
      ];
      const storedFilters = existingFilters.map(({ sourceId, ...filter }) => ({
        ...filter,
        source: sourceId,
      }));
      const dashboard = await createTestDashboard({
        filters: storedFilters,
      });
      const updatedPayload = createMockDashboardWithIds(
        traceSource._id.toString(),
        {
          name: 'Dashboard Name Updated With Empty Filters',
          filters: [],
        },
      );

      const response = await authRequest('put', `${BASE_URL}/${dashboard._id}`)
        .send(updatedPayload)
        .expect(200);

      expect(response.body.data.name).toBe(
        'Dashboard Name Updated With Empty Filters',
      );
      expect(response.body.data.filters).toEqual([]);

      const getResponse = await authRequest(
        'get',
        `${BASE_URL}/${dashboard._id}`,
      ).expect(200);
      expect(getResponse.body.data.filters).toEqual([]);
    });

    it('should return 400 when filter source ID does not exist on update', async () => {
      const dashboard = await createTestDashboard();
      const nonExistentSourceId = new ObjectId().toString();
      const updatedPayload = createMockDashboardWithIds(
        traceSource._id.toString(),
        {
          name: 'Updated Name',
          filters: [
            {
              id: new ObjectId().toString(),
              type: 'QUERY_EXPRESSION' as const,
              name: 'Bad Source Filter',
              expression: 'environment',
              sourceId: nonExistentSourceId,
            },
          ],
        },
      );

      const response = await authRequest('put', `${BASE_URL}/${dashboard._id}`)
        .send(updatedPayload)
        .expect(400);

      expect(response.body).toEqual({
        message: `Could not find the following source IDs: ${nonExistentSourceId}`,
      });
    });

    it('should return 404 when dashboard does not exist', async () => {
      const nonExistentId = new ObjectId().toString();
      const mockDashboard = createMockDashboardWithIds(
        traceSource._id.toString(),
      );

      await authRequest('put', `${BASE_URL}/${nonExistentId}`)
        .send(mockDashboard)
        .expect(404);
    });

    it('should preserve tile IDs that match existing tiles and generate new IDs for unrecognized tiles', async () => {
      const dashboard = await createTestDashboard();
      const sourceId = traceSource._id.toString();

      // First PUT to establish a tile with a server-assigned ID
      const firstResponse = await authRequest(
        'put',
        `${BASE_URL}/${dashboard._id}`,
      )
        .send({
          name: 'Initial',
          tiles: [createTimeSeriesChart(sourceId)],
          tags: [],
        })
        .expect(200);
      const existingTileId = firstResponse.body.data.tiles[0].id;

      // Second PUT: one tile with the existing ID (should be preserved),
      // one tile with an unrecognized ID (should be replaced)
      const unknownTileId = new ObjectId().toString();
      const response = await authRequest('put', `${BASE_URL}/${dashboard._id}`)
        .send({
          name: 'Updated',
          tiles: [
            { ...createTimeSeriesChart(sourceId), id: existingTileId },
            { ...createTimeSeriesChart(sourceId), id: unknownTileId, x: 6 },
          ],
          tags: [],
        })
        .expect(200);

      expect(response.body.data.tiles[0].id).toBe(existingTileId);
      expect(response.body.data.tiles[1].id).not.toBe(unknownTileId);
      expect(typeof response.body.data.tiles[1].id).toBe('string');
      expect(response.body.data.tiles[1].id.length).toBeGreaterThan(0);
    });

    it('should preserve filter IDs that match existing filters and generate new IDs for unrecognized filters', async () => {
      const dashboard = await createTestDashboard();
      const sourceId = traceSource._id.toString();

      // First PUT to establish a filter with a server-assigned ID
      const firstResponse = await authRequest(
        'put',
        `${BASE_URL}/${dashboard._id}`,
      )
        .send({
          name: 'Initial',
          tiles: [createTimeSeriesChart(sourceId)],
          tags: [],
          filters: [
            {
              id: new ObjectId().toString(),
              type: 'QUERY_EXPRESSION' as const,
              name: 'Environment',
              expression: 'environment',
              sourceId,
            },
          ],
        })
        .expect(200);
      const existingFilterId = firstResponse.body.data.filters[0].id;

      // Second PUT: one filter with the existing ID (should be preserved),
      // one filter with an unrecognized ID (should be replaced)
      const unknownFilterId = new ObjectId().toString();
      const response = await authRequest('put', `${BASE_URL}/${dashboard._id}`)
        .send({
          name: 'Updated',
          tiles: [createTimeSeriesChart(sourceId)],
          tags: [],
          filters: [
            {
              id: existingFilterId,
              type: 'QUERY_EXPRESSION' as const,
              name: 'Environment',
              expression: 'environment',
              sourceId,
            },
            {
              id: unknownFilterId,
              type: 'QUERY_EXPRESSION' as const,
              name: 'Service',
              expression: 'service_name',
              sourceId,
            },
          ],
        })
        .expect(200);

      expect(response.body.data.filters[0].id).toBe(existingFilterId);
      expect(response.body.data.filters[1].id).not.toBe(unknownFilterId);
      expect(typeof response.body.data.filters[1].id).toBe('string');
      expect(response.body.data.filters[1].id.length).toBeGreaterThan(0);
    });

    it('can update all supported chart types and all supported fields on each chart type', async () => {
      // Arrange
      const lineChart = {
        id: new ObjectId().toString(),
        name: 'Line Chart',
        x: 0,
        y: 0,
        w: 6,
        h: 3,
        asRatio: true,
        series: [
          {
            type: 'time',
            sourceId: traceSource._id.toString(),
            aggFn: 'quantile',
            level: 0.95,
            field: 'Duration',
            alias: '95th Percentile Duration',
            where: "env = 'production'",
            whereLanguage: 'sql',
            groupBy: ['service.name', 'StatusCode'],
            numberFormat: {
              output: 'time',
              factor: 0.001,
              unit: 'ms',
            },
            displayType: 'line',
          } satisfies TimeChartSeries,
          {
            type: 'time',
            sourceId: traceSource._id.toString(),
            aggFn: 'quantile',
            level: 0.99,
            field: 'Duration',
            alias: '99th Percentile Duration',
            where: 'env:production',
            whereLanguage: 'lucene',
            groupBy: ['service.name', 'StatusCode'],
            numberFormat: {
              output: 'time',
              factor: 0.001,
              unit: 'ms',
            },
            displayType: 'line',
          } satisfies TimeChartSeries,
        ],
      };

      const barChart = {
        id: new ObjectId().toString(),
        name: 'Bar Chart',
        x: 6,
        y: 0,
        w: 6,
        h: 3,
        asRatio: false,
        series: [
          {
            type: 'time',
            sourceId: metricSource._id.toString(),
            aggFn: 'quantile',
            level: 0.95,
            field: '',
            metricName: 'ClickHouseAsyncMetrics_BlockWriteBytes_ram1',
            metricDataType: MetricsDataType.Gauge,
            alias: '95th Percentile Duration',
            where: "env = 'production'",
            whereLanguage: 'sql',
            groupBy: [],
            numberFormat: {
              output: 'byte',
              decimalBytes: true,
              mantissa: 0,
            },
            displayType: 'stacked_bar',
          } satisfies TimeChartSeries,
        ],
      };

      const tableChart = {
        id: new ObjectId().toString(),
        name: 'Table Chart',
        x: 12,
        y: 0,
        w: 6,
        h: 3,
        asRatio: false,
        series: [
          {
            type: 'table',
            sourceId: traceSource._id.toString(),
            aggFn: 'quantile',
            level: 0.5,
            field: 'Duration',
            alias: 'Median Duration',
            where: "env = 'production'",
            whereLanguage: 'sql',
            groupBy: ['service.name'],
            sortOrder: 'desc',
            numberFormat: {
              output: 'percent',
              mantissa: 2,
              thousandSeparated: true,
              average: true,
            },
          } satisfies TableChartSeries,
          {
            type: 'table',
            sourceId: traceSource._id.toString(),
            aggFn: 'quantile',
            level: 0.99,
            field: 'Duration',
            alias: '99th Percentile Duration',
            where: "env = 'production'",
            whereLanguage: 'sql',
            groupBy: ['service.name'],
            sortOrder: 'desc',
            numberFormat: {
              output: 'percent',
              mantissa: 2,
              thousandSeparated: true,
              average: true,
            },
          } satisfies TableChartSeries,
        ],
      };

      const numberChart = {
        id: new ObjectId().toString(),
        name: 'Number Chart',
        x: 18,
        y: 0,
        w: 6,
        h: 3,
        asRatio: false,
        series: [
          {
            type: 'number',
            sourceId: traceSource._id.toString(),
            aggFn: 'quantile',
            level: 0.5,
            field: 'Duration',
            alias: '50th Percentile Duration',
            where: "env = 'production'",
            whereLanguage: 'sql',
            numberFormat: {
              output: 'percent',
              mantissa: 2,
              thousandSeparated: true,
              average: true,
            },
          } satisfies NumberChartSeries,
        ],
      };

      const markdownChart = {
        id: new ObjectId().toString(),
        name: 'Markdown Chart',
        x: 0,
        y: 3,
        w: 6,
        h: 3,
        asRatio: false,
        series: [
          {
            type: 'markdown',
            content: '# Markdown Content',
          } satisfies MarkdownChartSeries,
        ],
      };

      // Create an initial dashboard to update
      const initialDashboard = await createTestDashboard();

      // Act
      const response = await authRequest(
        'put',
        `${BASE_URL}/${initialDashboard._id}`,
      )
        .send({
          name: 'Dashboard with All Chart Types',
          tiles: [lineChart, barChart, tableChart, numberChart, markdownChart],
          tags: ['round-trip-test'],
        })
        .expect(200);

      // Expected responses
      const lineChartExpected: ExternalDashboardTile = {
        name: 'Line Chart',
        x: 0,
        y: 0,
        w: 6,
        h: 3,
        config: {
          displayType: 'line',
          asRatio: true,
          fillNulls: true,
          sourceId: traceSource._id.toString(),
          numberFormat: {
            output: 'time',
            factor: 0.001,
            unit: 'ms',
          },
          groupBy: 'service.name,StatusCode',
          select: [
            {
              aggFn: 'quantile',
              level: 0.95,
              valueExpression: 'Duration',
              alias: '95th Percentile Duration',
              where: "env = 'production'",
              whereLanguage: 'sql',
            },
            {
              aggFn: 'quantile',
              level: 0.99,
              valueExpression: 'Duration',
              alias: '99th Percentile Duration',
              where: 'env:production',
              whereLanguage: 'lucene',
            },
          ],
        },
      };

      const barChartExpected: ExternalDashboardTile = {
        name: 'Bar Chart',
        x: 6,
        y: 0,
        w: 6,
        h: 3,
        config: {
          displayType: 'stacked_bar',
          asRatio: false,
          fillNulls: true,
          sourceId: metricSource._id.toString(),
          numberFormat: {
            output: 'byte',
            decimalBytes: true,
            mantissa: 0,
          },
          select: [
            {
              aggFn: 'quantile',
              level: 0.95,
              valueExpression: '',
              metricName: 'ClickHouseAsyncMetrics_BlockWriteBytes_ram1',
              metricType: MetricsDataType.Gauge,
              alias: '95th Percentile Duration',
              where: "env = 'production'",
              whereLanguage: 'sql',
            },
          ],
        },
      };

      const tableChartExpected: ExternalDashboardTile = {
        name: 'Table Chart',
        x: 12,
        y: 0,
        w: 6,
        h: 3,
        config: {
          displayType: 'table',
          asRatio: false,
          sourceId: traceSource._id.toString(),
          select: [
            {
              aggFn: 'quantile',
              level: 0.5,
              valueExpression: 'Duration',
              alias: 'Median Duration',
              where: "env = 'production'",
              whereLanguage: 'sql',
            },
            {
              aggFn: 'quantile',
              level: 0.99,
              valueExpression: 'Duration',
              alias: '99th Percentile Duration',
              where: "env = 'production'",
              whereLanguage: 'sql',
            },
          ],
          groupBy: 'service.name',
          numberFormat: {
            output: 'percent',
            mantissa: 2,
            thousandSeparated: true,
            average: true,
          },
        },
      };

      const numberChartExpected: ExternalDashboardTile = {
        name: 'Number Chart',
        x: 18,
        y: 0,
        w: 6,
        h: 3,
        config: {
          displayType: 'number',
          sourceId: traceSource._id.toString(),
          select: [
            {
              aggFn: 'quantile',
              level: 0.5,
              valueExpression: 'Duration',
              alias: '50th Percentile Duration',
              where: "env = 'production'",
              whereLanguage: 'sql',
            },
          ],
          numberFormat: {
            output: 'percent',
            mantissa: 2,
            thousandSeparated: true,
            average: true,
          },
        },
      };

      const markdownChartExpected: ExternalDashboardTile = {
        name: 'Markdown Chart',
        x: 0,
        y: 3,
        w: 6,
        h: 3,
        config: {
          displayType: 'markdown',
          markdown: '# Markdown Content',
        },
      };

      // Assert response matches input (tile IDs are server-generated since the dashboard was empty)
      expect(omit(response.body.data.tiles[0], ['id'])).toEqual(
        lineChartExpected,
      );
      expect(omit(response.body.data.tiles[1], ['id'])).toEqual(
        barChartExpected,
      );
      expect(omit(response.body.data.tiles[2], ['id'])).toEqual(
        tableChartExpected,
      );
      expect(omit(response.body.data.tiles[3], ['id'])).toEqual(
        numberChartExpected,
      );
      expect(omit(response.body.data.tiles[4], ['id'])).toEqual(
        markdownChartExpected,
      );
    });

    it('should return 400 when source IDs do not exist', async () => {
      const dashboard = await createTestDashboard();
      const nonExistentSourceId = new ObjectId().toString();
      const updatedDashboard = createMockDashboardWithIds(nonExistentSourceId, {
        name: 'Updated Dashboard Name',
      });

      const response = await authRequest('put', `${BASE_URL}/${dashboard._id}`)
        .send(updatedDashboard)
        .expect(400);

      expect(response.body).toEqual({
        message: `Could not find the following source IDs: ${nonExistentSourceId}`,
      });
    });
  });
});

describe('External API v2 Dashboards - new format', () => {
  // Test data factory functions
  const createMockDashboard = (sourceId: string, overrides = {}) => ({
    name: 'Test External Dashboard',
    tiles: [makeExternalTile({ sourceId }), makeExternalTile({ sourceId })],
    tags: TEST_TAGS,
    ...overrides,
  });

  const createMockDashboardWithIds = (sourceId: string, overrides = {}) => ({
    name: 'Test External Dashboard with IDs',
    tiles: [
      {
        ...makeExternalTile({ sourceId }),
        id: new ObjectId().toString(),
      },
      {
        ...makeExternalTile({ sourceId }),
        id: new ObjectId().toString(),
      },
    ],
    tags: TEST_TAGS,
    filters: [],
    ...overrides,
  });

  // Test chart factory functions
  const createTimeSeriesChart = (
    sourceId: string,
  ): ExternalDashboardTileWithId => ({
    id: new ObjectId().toString(),
    name: 'Time Series Chart',
    x: 0,
    y: 0,
    w: 6,
    h: 3,
    config: {
      displayType: 'line',
      sourceId,
      select: [
        {
          aggFn: 'count',
          where: '',
        },
      ],
    },
  });

  const createTableChart = (sourceId: string): ExternalDashboardTileWithId => ({
    name: 'Table Chart',
    x: 6,
    y: 0,
    w: 6,
    h: 3,
    id: new ObjectId().toString(),
    config: {
      displayType: 'table',
      sourceId,
      select: [
        {
          aggFn: 'count',
          where: '',
        },
      ],
    },
  });

  const createNumberChart = (
    sourceId: string,
  ): ExternalDashboardTileWithId => ({
    name: 'Number Chart',
    x: 0,
    y: 3,
    w: 3,
    h: 3,
    id: new ObjectId().toString(),
    config: {
      displayType: 'number',
      sourceId,
      select: [
        {
          aggFn: 'count',
          where: '',
        },
      ],
    },
  });

  const createMarkdownChart = (): ExternalDashboardTileWithId => ({
    name: 'Markdown Chart',
    x: 3,
    y: 3,
    w: 3,
    h: 3,
    id: new ObjectId().toString(),
    config: {
      displayType: 'markdown',
      markdown: '# Test Markdown\nThis is a test',
    },
  });

  const createPieChart = (sourceId: string): ExternalDashboardTileWithId => ({
    name: 'Pie Chart',
    x: 6,
    y: 3,
    w: 3,
    h: 3,
    id: new ObjectId().toString(),
    config: {
      displayType: 'pie',
      sourceId,
      select: [
        {
          aggFn: 'count',
          where: '',
        },
      ],
      groupBy: 'service.name',
    },
  });

  const server = getServer();
  let agent, team, user, traceSource, metricSource, connection;

  beforeAll(async () => {
    await server.start();
  });

  beforeEach(async () => {
    // Setup authenticated agent for each test
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

    traceSource = await Source.create({
      kind: SourceKind.Trace,
      team: team._id,
      from: {
        databaseName: DEFAULT_DATABASE,
        tableName: DEFAULT_TRACES_TABLE,
      },
      timestampValueExpression: 'Timestamp',
      connection: connection._id,
      name: 'Traces',
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
  });

  afterEach(async () => {
    await server.clearDBs();
  });

  afterAll(async () => {
    await server.stop();
  });

  // Helper to create a dashboard in the database
  const createTestDashboard = async (dashboardData = {}) => {
    return new Dashboard({
      name: 'Test Dashboard',
      tiles: [],
      team: team._id,
      ...dashboardData,
    }).save();
  };

  // Helper to make authenticated requests
  const authRequest = (method, url) => {
    return agent[method](url).set('Authorization', `Bearer ${user?.accessKey}`);
  };

  describe('Response Format', () => {
    it('should return responses in the expected format', async () => {
      // Create a dashboard with known values for testing
      const testDashboard = {
        name: 'Format Test Dashboard',
        tiles: [
          createTimeSeriesChart(traceSource._id.toString()),
          createNumberChart(traceSource._id.toString()),
        ],
        tags: ['format-test'],
      };

      // Create the dashboard
      const createResponse = await authRequest('post', BASE_URL)
        .send(testDashboard)
        .expect(200);

      // Verify full response structure
      expect(createResponse.headers['content-type']).toMatch(
        /application\/json/,
      );
      expect(createResponse.body).toEqual({
        data: {
          id: expect.any(String),
          name: 'Format Test Dashboard',
          tiles: [
            {
              id: expect.any(String),
              name: 'Time Series Chart',
              x: 0,
              y: 0,
              w: 6,
              h: 3,
              config: {
                asRatio: false,
                fillNulls: true,
                displayType: 'line',
                sourceId: traceSource._id.toString(),
                select: [
                  {
                    aggFn: 'count',
                    where: '',
                    valueExpression: '',
                    whereLanguage: 'lucene',
                  },
                ],
              },
            },
            {
              id: expect.any(String),
              name: 'Number Chart',
              x: 0,
              y: 3,
              w: 3,
              h: 3,
              config: {
                displayType: 'number',
                sourceId: traceSource._id.toString(),
                select: [
                  {
                    aggFn: 'count',
                    where: '',
                    valueExpression: '',
                    whereLanguage: 'lucene',
                  },
                ],
              },
            },
          ],
          tags: ['format-test'],
          filters: [],
          savedQuery: null,
          savedQueryLanguage: null,
          savedFilterValues: [],
        },
      });

      // Get the dashboard to verify consistent format
      const dashboardId = createResponse.body.data.id;
      const getResponse = await authRequest(
        'get',
        `${BASE_URL}/${dashboardId}`,
      ).expect(200);

      // Verify get response has same structure
      expect(getResponse.headers['content-type']).toMatch(/application\/json/);
      expect(getResponse.body).toEqual({
        data: createResponse.body.data,
      });

      // List endpoint format
      const listResponse = await authRequest('get', BASE_URL).expect(200);

      expect(listResponse.headers['content-type']).toMatch(/application\/json/);
      expect(listResponse.body).toHaveProperty('data');
      expect(Array.isArray(listResponse.body.data)).toBe(true);

      // Delete response format
      const deleteResponse = await authRequest(
        'delete',
        `${BASE_URL}/${dashboardId}`,
      ).expect(200);

      expect(deleteResponse.body).toEqual({});
    });
  });

  describe('GET /', () => {
    it('should return all dashboards', async () => {
      // Create test dashboards
      await createTestDashboard({ name: 'Test Dashboard 1' });
      await createTestDashboard({ name: 'Test Dashboard 2' });

      const response = await authRequest('get', BASE_URL).expect(200);

      expect(response.body.data).toHaveLength(2);
      expect(response.body.data.map(d => d.name)).toContain('Test Dashboard 1');
      expect(response.body.data.map(d => d.name)).toContain('Test Dashboard 2');
      response.body.data.forEach((d: { filters: unknown }) => {
        expect(d).toHaveProperty('filters');
        expect(Array.isArray(d.filters)).toBe(true);
      });
    });

    it('should return empty array when no dashboards exist', async () => {
      const response = await authRequest('get', BASE_URL).expect(200);
      expect(response.body.data).toHaveLength(0);
    });
  });

  describe('GET /:id', () => {
    it('should return a specific dashboard', async () => {
      const dashboard = await createTestDashboard({
        name: 'Test Dashboard',
        tags: ['tag1', 'tag2'],
      });

      const response = await authRequest(
        'get',
        `${BASE_URL}/${dashboard._id}`,
      ).expect(200);

      expect(response.body.data).toMatchObject({
        id: dashboard._id.toString(),
        name: 'Test Dashboard',
        tiles: expect.arrayContaining([]),
        tags: ['tag1', 'tag2'],
      });
      expect(response.body.data).toHaveProperty('filters');
      expect(Array.isArray(response.body.data.filters)).toBe(true);
    });

    it('should return 404 when dashboard does not exist', async () => {
      const nonExistentId = new ObjectId().toString();
      await authRequest('get', `${BASE_URL}/${nonExistentId}`).expect(404);
    });
  });

  describe('POST /', () => {
    it('should create a new dashboard', async () => {
      const mockDashboard = createMockDashboard(traceSource._id.toString());

      const response = await authRequest('post', BASE_URL)
        .send(mockDashboard)
        .expect(200);

      expect(response.body.data).toMatchObject({
        name: mockDashboard.name,
        tiles: expect.arrayContaining([
          expect.objectContaining({ name: 'Test Chart' }),
          expect.objectContaining({ name: 'Test Chart' }),
        ]),
        tags: mockDashboard.tags,
      });
      expect(response.body.data).toHaveProperty('filters');
      expect(response.body.data.filters).toEqual([]);

      // Verify dashboard was created in database
      const dashboards = await Dashboard.find({}).lean();
      expect(dashboards).toHaveLength(1);
      expect(dashboards[0].name).toBe(mockDashboard.name);
      expect(dashboards[0].tiles).toHaveLength(2);
    });

    it('should return 400 when savedQueryLanguage is null and savedQuery is provided', async () => {
      const mockDashboard = createMockDashboard(traceSource._id.toString(), {
        savedQuery: "service.name = 'api'",
        savedQueryLanguage: null,
      });

      const response = await authRequest('post', BASE_URL)
        .send(mockDashboard)
        .expect(400);

      expect(response.body.message).toContain(
        'savedQueryLanguage cannot be null when savedQuery is provided',
      );
    });

    it('can create all chart types', async () => {
      const dashboardWithAllCharts = {
        name: 'Test Dashboard with All Chart Types',
        tiles: [
          createTimeSeriesChart(traceSource._id.toString()),
          createTableChart(traceSource._id.toString()),
          createNumberChart(traceSource._id.toString()),
          createMarkdownChart(),
          createPieChart(traceSource._id.toString()),
        ],
        tags: ['test', 'chart-types'],
      };

      const response = await authRequest('post', BASE_URL)
        .send(dashboardWithAllCharts)
        .expect(200);

      const { id } = response.body.data;
      expect(response.body.data).toHaveProperty('id');
      expect(response.body.data.tiles.length).toBe(5);

      // Verify by retrieving the dashboard
      const retrieveResponse = await authRequest('get', `${BASE_URL}/${id}`);

      expect(retrieveResponse.status).toBe(200);
      expect(retrieveResponse.body.data.tiles.length).toBe(5);
      expect(retrieveResponse.body.data.tags).toEqual(['test', 'chart-types']);
    });

    it('can round-trip all supported chart types and all supported fields on each chart type', async () => {
      // Arrange
      const pieChart: ExternalDashboardTile = {
        name: 'Pie Chart',
        x: 6,
        y: 3,
        w: 6,
        h: 3,
        config: {
          displayType: 'pie',
          sourceId: traceSource._id.toString(),
          select: [
            {
              aggFn: 'quantile',
              level: 0.5,
              valueExpression: 'Duration',
              alias: 'Median Duration',
              where: "env = 'production'",
              whereLanguage: 'sql',
            },
          ],
          groupBy: 'service.name',
          numberFormat: {
            output: 'number',
            mantissa: 2,
          },
        },
      };

      const lineChart: ExternalDashboardTile = {
        name: 'Line Chart',
        x: 0,
        y: 0,
        w: 6,
        h: 3,
        config: {
          displayType: 'line',
          asRatio: true,
          fillNulls: true,
          fitYAxisToData: true,
          sourceId: traceSource._id.toString(),
          numberFormat: {
            output: 'time',
            factor: 0.001,
            unit: 'ms',
          },
          groupBy: 'service.name, StatusCode',
          select: [
            {
              aggFn: 'quantile',
              level: 0.95,
              valueExpression: 'Duration',
              alias: '95th Percentile Duration',
              where: "env = 'production'",
              whereLanguage: 'sql',
              numberFormat: {
                output: 'duration',
                factor: 1e-9,
              },
            },
            {
              aggFn: 'quantile',
              level: 0.99,
              valueExpression: 'Duration',
              alias: '99th Percentile Duration',
              where: 'env:production',
              whereLanguage: 'lucene',
              numberFormat: {
                output: 'duration',
                factor: 1e-9,
                mantissa: 3,
              },
            },
          ],
        },
      };

      const barChart: ExternalDashboardTile = {
        name: 'Bar Chart',
        x: 6,
        y: 0,
        w: 6,
        h: 3,
        config: {
          displayType: 'stacked_bar',
          asRatio: false,
          fillNulls: false,
          sourceId: metricSource._id.toString(),
          numberFormat: {
            output: 'byte',
            decimalBytes: true,
            mantissa: 0,
          },
          select: [
            {
              aggFn: 'quantile',
              level: 0.95,
              valueExpression: 'Duration',
              metricName: 'ClickHouseAsyncMetrics_BlockWriteBytes_ram1',
              metricType: MetricsDataType.Gauge,
              alias: '95th Percentile Duration',
              where: "env = 'production'",
              whereLanguage: 'sql',
            },
          ],
        },
      };

      const tableChart: ExternalDashboardTile = {
        name: 'Table Chart',
        x: 12,
        y: 0,
        w: 6,
        h: 3,
        config: {
          displayType: 'table',
          asRatio: false,
          sourceId: traceSource._id.toString(),
          select: [
            {
              aggFn: 'quantile',
              level: 0.5,
              valueExpression: 'Duration',
              alias: 'Median Duration',
              where: "env = 'production'",
              whereLanguage: 'sql',
              numberFormat: {
                output: 'duration',
                factor: 1e-9,
              },
            },
            {
              aggFn: 'quantile',
              level: 0.99,
              valueExpression: 'Duration',
              alias: '99th Percentile Duration',
              where: "env = 'production'",
              whereLanguage: 'sql',
            },
          ],
          groupBy: 'service.name',
          orderBy: 'service.name desc',
          having: 'percentiles(Duration, 0.5) > 100',
          numberFormat: {
            output: 'percent',
            mantissa: 2,
            thousandSeparated: true,
            average: true,
          },
          groupByColumnsOnLeft: true,
          onClick: {
            type: 'search',
            target: {
              mode: 'id',
              id: traceSource._id.toString(),
            },
            whereLanguage: 'sql',
            whereTemplate: "ServiceName = '{{service.name}}'",
            filters: [
              {
                kind: 'expressionTemplate',
                expression: 'ServiceName',
                template: '{{service.name}}',
              },
            ],
          },
        },
      };

      const numberChart: ExternalDashboardTile = {
        name: 'Number Chart',
        x: 18,
        y: 0,
        w: 6,
        h: 3,
        config: {
          displayType: 'number',
          sourceId: traceSource._id.toString(),
          select: [
            {
              aggFn: 'quantile',
              level: 0.5,
              valueExpression: 'Duration',
              alias: '50th Percentile Duration',
              where: "env = 'production'",
              whereLanguage: 'sql',
              numberFormat: {
                output: 'duration',
                factor: 1e-9,
              },
            },
          ],
          numberFormat: {
            output: 'percent',
            mantissa: 2,
            thousandSeparated: true,
            average: true,
          },
          color: 'chart-green',
          colorRules: [
            {
              operator: 'gt',
              value: 1000,
              color: 'chart-warning',
              label: 'Slow',
            },
            {
              operator: 'between',
              value: [200, 1000],
              color: 'chart-blue',
            },
            {
              operator: 'gte',
              value: 5000,
              color: 'chart-error',
              label: 'Critical',
            },
          ],
        },
      };

      const markdownChart: ExternalDashboardTile = {
        name: 'Markdown Chart',
        x: 0,
        y: 3,
        w: 6,
        h: 3,
        config: {
          displayType: 'markdown',
          markdown: '# Markdown Content',
        },
      };

      const heatmapChart: ExternalDashboardTile = {
        name: 'Heatmap Chart',
        x: 12,
        y: 3,
        w: 6,
        h: 3,
        config: {
          displayType: 'heatmap',
          sourceId: traceSource._id.toString(),
          select: [
            {
              valueExpression: 'Duration',
              countExpression: 'count()',
              heatmapScaleType: 'log',
            },
          ],
          where: "ServiceName = 'api'",
          whereLanguage: 'sql',
          numberFormat: {
            output: 'time',
            factor: 0.001,
            unit: 'ms',
          },
        },
      };

      // Act
      const response = await authRequest('post', BASE_URL)
        .send({
          name: 'Dashboard with All Chart Types',
          tiles: [
            lineChart,
            barChart,
            tableChart,
            numberChart,
            markdownChart,
            pieChart,
            heatmapChart,
          ],
          tags: ['round-trip-test'],
        })
        .expect(200);

      // Assert response matches input (ignoring generated IDs)
      expect(omit(response.body.data.tiles[0], ['id'])).toEqual(lineChart);
      expect(omit(response.body.data.tiles[1], ['id'])).toEqual(barChart);
      expect(omit(response.body.data.tiles[2], ['id'])).toEqual(tableChart);
      expect(omit(response.body.data.tiles[3], ['id'])).toEqual(numberChart);
      expect(omit(response.body.data.tiles[4], ['id'])).toEqual(markdownChart);
      expect(omit(response.body.data.tiles[5], ['id'])).toEqual(pieChart);
      expect(omit(response.body.data.tiles[6], ['id'])).toEqual(heatmapChart);
    });

    // Schema-level rejections that exercise pure Zod constraints
    // (discriminated-union absence, `min(1)` on valueExpression, and
    // `length(1)` on the select array). The non-Trace-source case
    // exercises the new `getHeatmapTilesWithIncompatibleSources` path
    // and stays its own test below.
    it.each([
      {
        label: 'raw SQL heatmap tile (heatmap is builder-only)',
        config: {
          configType: 'sql',
          displayType: 'heatmap',
          connectionId: () => connection._id.toString(),
          sqlTemplate: 'SELECT 1 FROM otel_logs WHERE {timeFilter}',
          sourceId: () => traceSource._id.toString(),
        },
      },
      {
        label: 'heatmap tile with empty valueExpression',
        config: {
          displayType: 'heatmap',
          sourceId: () => traceSource._id.toString(),
          select: [{ valueExpression: '' }],
        },
      },
      {
        label: 'heatmap tile with multiple select items',
        config: {
          displayType: 'heatmap',
          sourceId: () => traceSource._id.toString(),
          select: [
            { valueExpression: 'Duration' },
            { valueExpression: 'OtherValue' },
          ],
        },
      },
    ])('rejects $label', async ({ config }) => {
      // Resolve any lazy id fns now that the test setup has run.
      const resolved = Object.fromEntries(
        Object.entries(config).map(([key, value]) => [
          key,
          typeof value === 'function' ? value() : value,
        ]),
      );
      await authRequest('post', BASE_URL)
        .send({
          name: 'Dashboard with rejected heatmap',
          tiles: [
            {
              name: 'Heatmap',
              x: 0,
              y: 0,
              w: 6,
              h: 3,
              config: resolved,
            },
          ],
          tags: [],
        })
        .expect(400);
    });

    it('rejects heatmap tile with a non-Trace source (UI restricts to trace)', async () => {
      // Exercises the runtime check in
      // `getHeatmapTilesWithIncompatibleSources` rather than a pure Zod
      // constraint, kept as its own test so the assertion on the error
      // message stays pinned to the new code path.
      const heatmapMetricSource = {
        name: 'Heatmap Metric Source',
        x: 0,
        y: 0,
        w: 6,
        h: 3,
        config: {
          displayType: 'heatmap',
          sourceId: metricSource._id.toString(),
          select: [
            {
              valueExpression: 'Duration',
            },
          ],
        },
      };

      const response = await authRequest('post', BASE_URL)
        .send({
          name: 'Dashboard with Heatmap on Metric Source',
          tiles: [heatmapMetricSource],
          tags: [],
        })
        .expect(400);

      expect(response.body.message).toContain(
        'Heatmap tiles require a Trace source',
      );
    });

    it('round-trips a heatmap tile with only required fields', async () => {
      // Covers the minimal payload path: countExpression, heatmapScaleType,
      // where, whereLanguage, and numberFormat are all omitted on the
      // request. Guards against a regression where the deserializer's
      // `!== undefined` checks (v2/utils/dashboards.ts) drop optional fields
      // silently or coerce defaults that don't survive the read-back.
      const heatmapMinimalRequest = {
        name: 'Minimal Heatmap',
        x: 0,
        y: 0,
        w: 6,
        h: 3,
        config: {
          displayType: 'heatmap',
          sourceId: traceSource._id.toString(),
          select: [
            {
              valueExpression: 'Duration',
            },
          ],
        },
      };

      // Persistence applies two normalizations:
      //   `where: z.string().optional().default('')` (Zod schema), and
      //   the deserializer at v2/utils/dashboards.ts:514 fills
      //   `whereLanguage` with 'lucene' when omitted so the Mongo doc
      //   stays consistent across heatmap and non-heatmap chart types.
      // Both surface on read-back. The optional select-item fields stay
      // undefined.
      const expectedResponse: ExternalDashboardTile = {
        ...heatmapMinimalRequest,
        config: {
          displayType: 'heatmap',
          sourceId: traceSource._id.toString(),
          select: [
            {
              valueExpression: 'Duration',
            },
          ],
          where: '',
          whereLanguage: 'lucene',
        },
      };

      const response = await authRequest('post', BASE_URL)
        .send({
          name: 'Dashboard with Minimal Heatmap',
          tiles: [heatmapMinimalRequest],
          tags: [],
        })
        .expect(200);

      expect(omit(response.body.data.tiles[0], ['id'])).toEqual(
        expectedResponse,
      );
    });

    it('persists where as empty string when omitted from heatmap tile', async () => {
      const heatmapNoWhere = {
        name: 'Heatmap Without Where',
        x: 0,
        y: 0,
        w: 6,
        h: 3,
        config: {
          displayType: 'heatmap',
          sourceId: traceSource._id.toString(),
          select: [{ valueExpression: 'Duration' }],
        },
      };

      const response = await authRequest('post', BASE_URL)
        .send({
          name: 'Dashboard Heatmap No Where',
          tiles: [heatmapNoWhere],
          tags: [],
        })
        .expect(200);

      const dashboardInDb = await Dashboard.findById(
        response.body.data.id,
      ).lean();

      expect((dashboardInDb!.tiles[0].config as any).where).toBe('');
    });

    it('persists select-item where as empty string when omitted', async () => {
      const lineChartNoWhere = {
        name: 'Line Chart Without Where',
        x: 0,
        y: 0,
        w: 6,
        h: 3,
        config: {
          displayType: 'line',
          sourceId: traceSource._id.toString(),
          select: [{ aggFn: 'count' }],
        },
      };

      const response = await authRequest('post', BASE_URL)
        .send({
          name: 'Dashboard Line No Where',
          tiles: [lineChartNoWhere],
          tags: [],
        })
        .expect(200);

      const dashboardInDb = await Dashboard.findById(
        response.body.data.id,
      ).lean();

      expect(
        (dashboardInDb!.tiles[0].config as any).select[0].aggCondition,
      ).toBe('');
    });

    it('does not silently downgrade a corrupted heatmap to line on GET', async () => {
      // Seed a Dashboard directly via Mongo with a heatmap tile whose
      // select[0] lacks a non-empty valueExpression. The current API
      // reject path enforces the constraint on writes, but legacy or
      // direct-DB-edit data can still produce this state. The GET
      // converter must NOT fall through to the default 'line' tile
      // (which would cause silent data loss on a GET -> mutate -> PUT
      // round-trip), and must preserve `displayType: 'heatmap'` so the
      // breakage surfaces on re-PUT instead of being overwritten.
      const corruptedHeatmapDashboard = await new Dashboard({
        name: 'Dashboard with corrupted heatmap',
        team: team._id,
        tiles: [
          {
            id: new ObjectId().toString(),
            x: 0,
            y: 0,
            w: 6,
            h: 3,
            config: {
              displayType: 'heatmap',
              source: traceSource._id.toString(),
              select: [
                {
                  // Editor-shape heatmap select item that omits
                  // valueExpression, simulating legacy/corrupted data.
                  aggFn: 'count',
                  aggCondition: '',
                  aggConditionLanguage: 'lucene',
                  valueExpression: '',
                },
              ],
              where: '',
              whereLanguage: 'lucene',
              name: 'Bad Heatmap',
            },
          },
        ],
      }).save();

      const response = await authRequest(
        'get',
        `${BASE_URL}/${corruptedHeatmapDashboard._id}`,
      ).expect(200);

      expect(response.body.data.tiles).toHaveLength(1);
      expect(response.body.data.tiles[0].config.displayType).toBe('heatmap');
      expect(response.body.data.tiles[0].config.displayType).not.toBe('line');
    });

    it('can round-trip all raw SQL chart config types', async () => {
      const connectionId = connection._id.toString();
      const sourceId = traceSource._id.toString();
      const sqlTemplate = 'SELECT count() FROM otel_logs WHERE {timeFilter}';

      const lineRawSql: ExternalDashboardTile = {
        name: 'Line Raw SQL',
        x: 0,
        y: 0,
        w: 6,
        h: 3,
        config: {
          configType: 'sql',
          displayType: 'line',
          connectionId,
          sqlTemplate,
          sourceId,
          compareToPreviousPeriod: true,
          fillNulls: true,
          alignDateRangeToGranularity: true,
          fitYAxisToData: true,
          numberFormat: { output: 'number', mantissa: 2 },
        },
      };

      const barRawSql: ExternalDashboardTile = {
        name: 'Bar Raw SQL',
        x: 6,
        y: 0,
        w: 6,
        h: 3,
        config: {
          configType: 'sql',
          displayType: 'stacked_bar',
          connectionId,
          sqlTemplate,
          sourceId,
          fillNulls: false,
          alignDateRangeToGranularity: false,
          numberFormat: { output: 'byte', decimalBytes: true },
        },
      };

      const tableRawSql: ExternalDashboardTile = {
        name: 'Table Raw SQL',
        x: 0,
        y: 3,
        w: 6,
        h: 3,
        config: {
          configType: 'sql',
          displayType: 'table',
          connectionId,
          sqlTemplate,
          sourceId,
          numberFormat: { output: 'percent', mantissa: 1 },
          onClick: {
            type: 'search',
            target: {
              mode: 'template',
              template: '{{source_name}}',
            },
            whereLanguage: 'lucene',
            whereTemplate: 'ServiceName:"{{ServiceName}}"',
          },
        },
      };

      const numberRawSql: ExternalDashboardTile = {
        name: 'Number Raw SQL',
        x: 6,
        y: 3,
        w: 6,
        h: 3,
        config: {
          configType: 'sql',
          displayType: 'number',
          connectionId,
          sqlTemplate,
          sourceId,
          numberFormat: { output: 'currency', currencySymbol: '$' },
          // Raw SQL number tiles carry the static tile color (no colorRules).
          color: 'chart-purple',
        },
      };

      const pieRawSql: ExternalDashboardTile = {
        name: 'Pie Raw SQL',
        x: 12,
        y: 3,
        w: 6,
        h: 3,
        config: {
          configType: 'sql',
          displayType: 'pie',
          connectionId,
          sqlTemplate,
          sourceId,
        },
      };

      const response = await authRequest('post', BASE_URL)
        .send({
          name: 'Dashboard with Raw SQL Chart Types',
          tiles: [lineRawSql, barRawSql, tableRawSql, numberRawSql, pieRawSql],
          tags: ['raw-sql-test'],
        })
        .expect(200);

      expect(omit(response.body.data.tiles[0], ['id'])).toEqual(lineRawSql);
      expect(omit(response.body.data.tiles[1], ['id'])).toEqual(barRawSql);
      expect(omit(response.body.data.tiles[2], ['id'])).toEqual(tableRawSql);
      expect(omit(response.body.data.tiles[3], ['id'])).toEqual(numberRawSql);
      expect(omit(response.body.data.tiles[4], ['id'])).toEqual(pieRawSql);
    });

    it('persists fitYAxisToData on line tiles only and reads it back on GET', async () => {
      const sourceId = traceSource._id.toString();

      // A line tile that opts into fitYAxisToData; a bar tile that attempts to
      // set it (it is line-only, so it must be dropped); and a line tile that
      // omits the field entirely to confirm it stays absent (optional, no
      // default).
      const fitLine: ExternalDashboardTile = {
        name: 'Fit Line',
        x: 0,
        y: 0,
        w: 6,
        h: 3,
        config: {
          displayType: 'line',
          sourceId,
          fitYAxisToData: true,
          select: [{ aggFn: 'count', where: '', whereLanguage: 'sql' }],
        },
      };

      const bar: ExternalDashboardTile = {
        name: 'Bar',
        x: 6,
        y: 0,
        w: 6,
        h: 3,
        config: {
          displayType: 'stacked_bar',
          sourceId,
          // fitYAxisToData only applies to line charts; setting it on a bar
          // tile should be ignored rather than persisted.
          fitYAxisToData: false,
          select: [{ aggFn: 'count', where: '', whereLanguage: 'sql' }],
        } as ExternalDashboardTile['config'],
      };

      const unsetLine: ExternalDashboardTile = {
        name: 'Unset Line',
        x: 12,
        y: 0,
        w: 6,
        h: 3,
        config: {
          displayType: 'line',
          sourceId,
          select: [{ aggFn: 'count', where: '', whereLanguage: 'sql' }],
        },
      };

      const createResponse = await authRequest('post', BASE_URL)
        .send({
          name: 'fitYAxisToData dashboard',
          tiles: [fitLine, bar, unsetLine],
          tags: [],
        })
        .expect(200);

      const { id } = createResponse.body.data;

      const getResponse = await authRequest('get', `${BASE_URL}/${id}`).expect(
        200,
      );
      const tiles = getResponse.body.data.tiles;

      expect(tiles[0].config.fitYAxisToData).toBe(true);
      // Bar charts never carry fitYAxisToData — it is dropped on write.
      expect(tiles[1].config).not.toHaveProperty('fitYAxisToData');
      // Omitted on input → absent on read-back (optional, no default).
      expect(tiles[2].config).not.toHaveProperty('fitYAxisToData');
    });

    it('should return 400 when source IDs do not exist', async () => {
      const nonExistentSourceId = new ObjectId().toString();
      const mockDashboard = createMockDashboard(nonExistentSourceId);

      const response = await authRequest('post', BASE_URL)
        .send(mockDashboard)
        .expect(400);

      expect(response.body).toEqual({
        message: `Could not find the following source IDs: ${nonExistentSourceId}`,
      });
    });

    it('should return 400 when connection ID does not belong to the team', async () => {
      const otherTeamConnection = await Connection.create({
        team: new ObjectId(),
        name: 'Other Team Connection',
        host: config.CLICKHOUSE_HOST,
        username: config.CLICKHOUSE_USER,
        password: config.CLICKHOUSE_PASSWORD,
      });
      const otherConnectionId = otherTeamConnection._id.toString();

      const response = await authRequest('post', BASE_URL)
        .send({
          name: 'Dashboard with Foreign Connection',
          tiles: [
            {
              name: 'Raw SQL Tile',
              x: 0,
              y: 0,
              w: 6,
              h: 3,
              config: {
                configType: 'sql',
                displayType: 'line',
                connectionId: otherConnectionId,
                sqlTemplate: 'SELECT count() FROM otel_logs WHERE {timeFilter}',
              },
            },
          ],
          tags: [],
        })
        .expect(400);

      expect(response.body).toEqual({
        message: `Could not find the following connection IDs: ${otherConnectionId}`,
      });
    });

    it('should return 400 when source connection does not match tile connection', async () => {
      const otherConnection = await Connection.create({
        team: team._id,
        name: 'Other Connection',
        host: config.CLICKHOUSE_HOST,
        username: config.CLICKHOUSE_USER,
        password: config.CLICKHOUSE_PASSWORD,
      });

      const response = await authRequest('post', BASE_URL)
        .send({
          name: 'Dashboard with Mismatched Source Connection',
          tiles: [
            {
              name: 'Raw SQL Tile',
              x: 0,
              y: 0,
              w: 6,
              h: 3,
              config: {
                configType: 'sql',
                displayType: 'table',
                connectionId: otherConnection._id.toString(),
                sourceId: traceSource._id.toString(),
                sqlTemplate: 'SELECT count() FROM otel_logs',
              },
            },
          ],
          tags: [],
        })
        .expect(400);

      expect(response.body).toEqual({
        message: `The following source IDs do not match the specified connections: ${traceSource._id.toString()}`,
      });
    });

    it('should return 400 when a table tile onClick references a non-existent source', async () => {
      const nonExistentSourceId = new ObjectId().toString();

      const response = await authRequest('post', BASE_URL)
        .send({
          name: 'Dashboard with invalid onClick source',
          tiles: [
            {
              name: 'Table Chart',
              x: 0,
              y: 0,
              w: 6,
              h: 3,
              config: {
                displayType: 'table',
                sourceId: traceSource._id.toString(),
                select: [{ aggFn: 'count' }],
                onClick: {
                  type: 'search',
                  target: { mode: 'id', id: nonExistentSourceId },
                  whereLanguage: 'sql',
                },
              },
            },
          ],
        })
        .expect(400);

      expect(response.body).toEqual({
        message: `Could not find the following source IDs: ${nonExistentSourceId}`,
      });
    });

    it('should return 400 when a table tile onClick search target references a metric source', async () => {
      // The /search destination only supports log and trace sources.
      const response = await authRequest('post', BASE_URL)
        .send({
          name: 'Dashboard with metric onClick source',
          tiles: [
            {
              name: 'Table Chart',
              x: 0,
              y: 0,
              w: 6,
              h: 3,
              config: {
                displayType: 'table',
                sourceId: traceSource._id.toString(),
                select: [{ aggFn: 'count' }],
                onClick: {
                  type: 'search',
                  target: {
                    mode: 'id',
                    id: metricSource._id.toString(),
                  },
                  whereLanguage: 'sql',
                },
              },
            },
          ],
        })
        .expect(400);

      expect(response.body).toEqual({
        message: `The following onClick search source IDs are not log or trace sources: ${metricSource._id.toString()}`,
      });
    });

    it('should return 400 when a table tile onClick references a non-existent dashboard', async () => {
      const nonExistentDashboardId = new ObjectId().toString();

      const response = await authRequest('post', BASE_URL)
        .send({
          name: 'Dashboard with invalid onClick dashboard',
          tiles: [
            {
              name: 'Table Chart',
              x: 0,
              y: 0,
              w: 6,
              h: 3,
              config: {
                displayType: 'table',
                sourceId: traceSource._id.toString(),
                select: [{ aggFn: 'count' }],
                onClick: {
                  type: 'dashboard',
                  target: { mode: 'id', id: nonExistentDashboardId },
                  whereLanguage: 'sql',
                },
              },
            },
          ],
        })
        .expect(400);

      expect(response.body).toEqual({
        message: `Could not find the following onClick dashboard IDs: ${nonExistentDashboardId}`,
      });
    });

    it('should return 400 when an onClick dashboard belongs to another team', async () => {
      const otherTeamDashboard = await new Dashboard({
        name: 'Other Team Dashboard',
        tiles: [],
        team: new ObjectId(),
      }).save();

      const response = await authRequest('post', BASE_URL)
        .send({
          name: 'Dashboard referencing cross-team dashboard',
          tiles: [
            {
              name: 'Table Chart',
              x: 0,
              y: 0,
              w: 6,
              h: 3,
              config: {
                displayType: 'table',
                sourceId: traceSource._id.toString(),
                select: [{ aggFn: 'count' }],
                onClick: {
                  type: 'dashboard',
                  target: {
                    mode: 'id',
                    id: otherTeamDashboard._id.toString(),
                  },
                  whereLanguage: 'sql',
                },
              },
            },
          ],
        })
        .expect(400);

      expect(response.body).toEqual({
        message: `Could not find the following onClick dashboard IDs: ${otherTeamDashboard._id.toString()}`,
      });
    });

    it('should accept a table tile onClick with valid id references', async () => {
      const targetDashboard = await createTestDashboard({
        name: 'OnClick Target Dashboard',
      });

      const response = await authRequest('post', BASE_URL)
        .send({
          name: 'Dashboard with valid onClick references',
          tiles: [
            {
              name: 'Search Link Table',
              x: 0,
              y: 0,
              w: 6,
              h: 3,
              config: {
                displayType: 'table',
                sourceId: traceSource._id.toString(),
                select: [{ aggFn: 'count' }],
                onClick: {
                  type: 'search',
                  target: { mode: 'id', id: traceSource._id.toString() },
                  whereLanguage: 'sql',
                },
              },
            },
            {
              name: 'Dashboard Link Table',
              x: 6,
              y: 0,
              w: 6,
              h: 3,
              config: {
                displayType: 'table',
                sourceId: traceSource._id.toString(),
                select: [{ aggFn: 'count' }],
                onClick: {
                  type: 'dashboard',
                  target: {
                    mode: 'id',
                    id: targetDashboard._id.toString(),
                  },
                  whereLanguage: 'sql',
                },
              },
            },
          ],
        })
        .expect(200);

      expect(response.body.data.tiles[0].config.onClick).toEqual({
        type: 'search',
        target: { mode: 'id', id: traceSource._id.toString() },
        whereLanguage: 'sql',
      });
      expect(response.body.data.tiles[1].config.onClick).toEqual({
        type: 'dashboard',
        target: { mode: 'id', id: targetDashboard._id.toString() },
        whereLanguage: 'sql',
      });
    });

    it('should return 400 when a table tile onClick target.id is not a valid ObjectId', async () => {
      const response = await authRequest('post', BASE_URL)
        .send({
          name: 'Dashboard with invalid onClick id',
          tiles: [
            {
              name: 'Table Chart',
              x: 0,
              y: 0,
              w: 6,
              h: 3,
              config: {
                displayType: 'table',
                sourceId: traceSource._id.toString(),
                select: [{ aggFn: 'count' }],
                onClick: {
                  type: 'dashboard',
                  target: { mode: 'id', id: 'not-a-valid-object-id' },
                  whereLanguage: 'sql',
                },
              },
            },
          ],
        })
        .expect(400);

      expect(response.body.message).toMatch(/Invalid|validation|id/i);
    });

    it('should create a dashboard with filters', async () => {
      const dashboardPayload = {
        name: 'Dashboard with Filters',
        tiles: [makeExternalTile({ sourceId: traceSource._id.toString() })],
        tags: TEST_TAGS,
        filters: [
          {
            type: 'QUERY_EXPRESSION' as const,
            name: 'Environment',
            expression: 'environment',
            sourceId: traceSource._id.toString(),
          },
          {
            type: 'QUERY_EXPRESSION' as const,
            name: 'Service Filter',
            expression: 'service_name',
            sourceId: traceSource._id.toString(),
            sourceMetricType: undefined,
            // Scope to a single source (the common case for mixed-source
            // dashboards) — exercises the array round-trip.
            appliesToSourceIds: [traceSource._id.toString()],
          },
          {
            type: 'QUERY_EXPRESSION' as const,
            name: 'Region (Filtered)',
            expression: 'region',
            sourceId: traceSource._id.toString(),
            where: "environment = 'production'",
            whereLanguage: 'sql' as const,
            // Scope to multiple sources to exercise multi-entry arrays.
            appliesToSourceIds: [
              traceSource._id.toString(),
              metricSource._id.toString(),
            ],
          },
        ],
      };

      const response = await authRequest('post', BASE_URL)
        .send(dashboardPayload)
        .expect(200);

      expect(response.body.data.filters).toHaveLength(3);
      response.body.data.filters.forEach(
        (f: {
          id: string;
          name: string;
          expression: string;
          sourceId: string;
          type: string;
        }) => {
          expect(f).toHaveProperty('id');
          expect(typeof f.id).toBe('string');
          expect(f.id.length).toBeGreaterThan(0);
          expect(f).toMatchObject({
            type: 'QUERY_EXPRESSION',
            name: expect.any(String),
            expression: expect.any(String),
            sourceId: traceSource._id.toString(),
          });
        },
      );
      expect(response.body.data.filters[0].name).toBe('Environment');
      expect(response.body.data.filters[0].expression).toBe('environment');
      // Filter 0 omitted appliesToSourceIds (broadcast-to-all) — must NOT be
      // materialized as an empty array on read; the field stays absent so
      // the default semantics survive a save/load round-trip.
      expect(response.body.data.filters[0].appliesToSourceIds).toBeUndefined();
      expect(response.body.data.filters[1].name).toBe('Service Filter');
      expect(response.body.data.filters[1].expression).toBe('service_name');
      expect(response.body.data.filters[1].appliesToSourceIds).toEqual([
        traceSource._id.toString(),
      ]);
      expect(response.body.data.filters[2].name).toBe('Region (Filtered)');
      expect(response.body.data.filters[2].expression).toBe('region');
      expect(response.body.data.filters[2].where).toBe(
        "environment = 'production'",
      );
      expect(response.body.data.filters[2].whereLanguage).toBe('sql');
      expect(response.body.data.filters[2].appliesToSourceIds).toEqual([
        traceSource._id.toString(),
        metricSource._id.toString(),
      ]);

      const getResponse = await authRequest(
        'get',
        `${BASE_URL}/${response.body.data.id}`,
      ).expect(200);
      expect(getResponse.body.data.filters).toHaveLength(3);
      expect(getResponse.body.data.filters).toEqual(response.body.data.filters);
    });

    it('should return 400 when filter source ID does not exist', async () => {
      const nonExistentSourceId = new ObjectId().toString();
      const dashboardPayload = {
        name: 'Dashboard with Bad Filter Source',
        tiles: [makeExternalTile({ sourceId: traceSource._id.toString() })],
        tags: TEST_TAGS,
        filters: [
          {
            type: 'QUERY_EXPRESSION' as const,
            name: 'Bad Source Filter',
            expression: 'environment',
            sourceId: nonExistentSourceId,
          },
        ],
      };

      const response = await authRequest('post', BASE_URL)
        .send(dashboardPayload)
        .expect(400);

      expect(response.body).toEqual({
        message: `Could not find the following source IDs: ${nonExistentSourceId}`,
      });
    });

    it('should return 400 when create filter includes id', async () => {
      const dashboardPayload = {
        name: 'Dashboard with Invalid Filter ID',
        tiles: [makeExternalTile({ sourceId: traceSource._id.toString() })],
        tags: TEST_TAGS,
        filters: [
          {
            id: new ObjectId().toString(),
            type: 'QUERY_EXPRESSION' as const,
            name: 'Filter with ID',
            expression: 'environment',
            sourceId: traceSource._id.toString(),
          },
        ],
      };

      await authRequest('post', BASE_URL).send(dashboardPayload).expect(400);
    });
  });

  describe('PUT /:id', () => {
    it('should update an existing dashboard', async () => {
      const dashboard = await createTestDashboard();
      const updatedDashboard = createMockDashboardWithIds(
        traceSource._id.toString(),
        {
          name: 'Updated Dashboard Name',
        },
      );

      const response = await authRequest('put', `${BASE_URL}/${dashboard._id}`)
        .send(updatedDashboard)
        .expect(200);

      expect(response.body.data).toMatchObject({
        id: dashboard._id.toString(),
        name: 'Updated Dashboard Name',
        tiles: expect.arrayContaining([
          expect.objectContaining({ name: 'Test Chart' }),
          expect.objectContaining({ name: 'Test Chart' }),
        ]),
      });
      expect(response.body.data).toHaveProperty('filters');
      expect(Array.isArray(response.body.data.filters)).toBe(true);

      // Verify dashboard was updated in database
      const updatedDashboardInDb = await Dashboard.findById(
        dashboard._id,
      ).lean();
      expect(updatedDashboardInDb?.name).toBe('Updated Dashboard Name');
      expect(updatedDashboardInDb?.tiles).toHaveLength(2);
    });

    it('should return 400 when savedQueryLanguage is null and savedQuery is provided on update', async () => {
      const dashboard = await createTestDashboard();
      const updatedDashboard = createMockDashboardWithIds(
        traceSource._id.toString(),
        {
          savedQuery: "service.name = 'api'",
          savedQueryLanguage: null,
        },
      );

      const response = await authRequest('put', `${BASE_URL}/${dashboard._id}`)
        .send(updatedDashboard)
        .expect(400);

      expect(response.body.message).toContain(
        'savedQueryLanguage cannot be null when savedQuery is provided',
      );
    });

    it('should update dashboard filters when provided', async () => {
      const dashboard = await createTestDashboard();
      const filterId1 = new ObjectId().toString();
      const filterId2 = new ObjectId().toString();
      const updatedPayload = createMockDashboardWithIds(
        traceSource._id.toString(),
        {
          name: 'Dashboard with Filters',
          filters: [
            {
              id: filterId1,
              type: 'QUERY_EXPRESSION' as const,
              name: 'Updated Filter 1',
              expression: 'environment',
              sourceId: traceSource._id.toString(),
              // Broadcast filter: appliesToSourceIds intentionally omitted.
            },
            {
              id: filterId2,
              type: 'QUERY_EXPRESSION' as const,
              name: 'Updated Filter 2',
              expression: 'service_name',
              sourceId: traceSource._id.toString(),
              // Multi-source scope to exercise array round-trip on PUT.
              appliesToSourceIds: [
                traceSource._id.toString(),
                metricSource._id.toString(),
              ],
            },
          ],
        },
      );

      const response = await authRequest('put', `${BASE_URL}/${dashboard._id}`)
        .send(updatedPayload)
        .expect(200);

      expect(response.body.data.filters).toHaveLength(2);
      expect(response.body.data.filters[0]).toMatchObject({
        id: expect.any(String),
        type: 'QUERY_EXPRESSION',
        name: 'Updated Filter 1',
        expression: 'environment',
        sourceId: traceSource._id.toString(),
      });
      // Broadcast filter must stay broadcast on read — the field must not
      // be materialized into an empty array by save/load.
      expect(response.body.data.filters[0].appliesToSourceIds).toBeUndefined();
      expect(response.body.data.filters[1]).toMatchObject({
        id: expect.any(String),
        type: 'QUERY_EXPRESSION',
        name: 'Updated Filter 2',
        expression: 'service_name',
        sourceId: traceSource._id.toString(),
      });
      expect(response.body.data.filters[1].appliesToSourceIds).toEqual([
        traceSource._id.toString(),
        metricSource._id.toString(),
      ]);

      const getResponse = await authRequest(
        'get',
        `${BASE_URL}/${dashboard._id}`,
      ).expect(200);
      expect(getResponse.body.data.filters).toEqual(response.body.data.filters);
    });

    it('should preserve existing dashboard filters when filters are not provided', async () => {
      const existingFilterId1 = new ObjectId().toString();
      const existingFilterId2 = new ObjectId().toString();
      const existingFilters = [
        {
          id: existingFilterId1,
          type: 'QUERY_EXPRESSION' as const,
          name: 'Existing Filter 1',
          expression: 'environment',
          sourceId: traceSource._id.toString(),
          // Stored with a scope — a no-filters PUT must preserve it intact.
          appliesToSourceIds: [traceSource._id.toString()],
        },
        {
          id: existingFilterId2,
          type: 'QUERY_EXPRESSION' as const,
          name: 'Existing Filter 2',
          expression: 'service_name',
          sourceId: traceSource._id.toString(),
        },
      ];
      const storedFilters = existingFilters.map(({ sourceId, ...filter }) => ({
        ...filter,
        source: sourceId,
      }));
      const dashboard = await createTestDashboard({
        filters: storedFilters,
      });
      const updatedPayload = createMockDashboardWithIds(
        traceSource._id.toString(),
        {
          name: 'Dashboard Name Updated Without Filters',
        },
      );

      const response = await authRequest('put', `${BASE_URL}/${dashboard._id}`)
        .send(omit(updatedPayload, 'filters'))
        .expect(200);

      expect(response.body.data.name).toBe(
        'Dashboard Name Updated Without Filters',
      );
      expect(response.body.data.filters).toHaveLength(2);
      expect(response.body.data.filters[0]).toMatchObject(existingFilters[0]);
      expect(response.body.data.filters[1]).toMatchObject(existingFilters[1]);

      const getResponse = await authRequest(
        'get',
        `${BASE_URL}/${dashboard._id}`,
      ).expect(200);
      expect(getResponse.body.data.filters).toHaveLength(2);
      expect(getResponse.body.data.filters[0]).toMatchObject(
        existingFilters[0],
      );
      expect(getResponse.body.data.filters[1]).toMatchObject(
        existingFilters[1],
      );
    });

    it('should clear existing dashboard filters when provided an empty filters array', async () => {
      const existingFilterId1 = new ObjectId().toString();
      const existingFilterId2 = new ObjectId().toString();
      const existingFilters = [
        {
          id: existingFilterId1,
          type: 'QUERY_EXPRESSION' as const,
          name: 'Existing Filter 1',
          expression: 'environment',
          sourceId: traceSource._id.toString(),
        },
        {
          id: existingFilterId2,
          type: 'QUERY_EXPRESSION' as const,
          name: 'Existing Filter 2',
          expression: 'service_name',
          sourceId: traceSource._id.toString(),
        },
      ];
      const storedFilters = existingFilters.map(({ sourceId, ...filter }) => ({
        ...filter,
        source: sourceId,
      }));
      const dashboard = await createTestDashboard({
        filters: storedFilters,
      });
      const updatedPayload = createMockDashboardWithIds(
        traceSource._id.toString(),
        {
          name: 'Dashboard Name Updated With Empty Filters',
          filters: [],
        },
      );

      const response = await authRequest('put', `${BASE_URL}/${dashboard._id}`)
        .send(updatedPayload)
        .expect(200);

      expect(response.body.data.name).toBe(
        'Dashboard Name Updated With Empty Filters',
      );
      expect(response.body.data.filters).toEqual([]);

      const getResponse = await authRequest(
        'get',
        `${BASE_URL}/${dashboard._id}`,
      ).expect(200);
      expect(getResponse.body.data.filters).toEqual([]);
    });

    it('should return 400 when filter source ID does not exist on update', async () => {
      const dashboard = await createTestDashboard();
      const nonExistentSourceId = new ObjectId().toString();
      const updatedPayload = createMockDashboardWithIds(
        traceSource._id.toString(),
        {
          name: 'Updated Name',
          filters: [
            {
              id: new ObjectId().toString(),
              type: 'QUERY_EXPRESSION' as const,
              name: 'Bad Source Filter',
              expression: 'environment',
              sourceId: nonExistentSourceId,
            },
          ],
        },
      );

      const response = await authRequest('put', `${BASE_URL}/${dashboard._id}`)
        .send(updatedPayload)
        .expect(400);

      expect(response.body).toEqual({
        message: `Could not find the following source IDs: ${nonExistentSourceId}`,
      });
    });

    it('should return 404 when dashboard does not exist', async () => {
      const nonExistentId = new ObjectId().toString();
      const mockDashboard = createMockDashboardWithIds(
        traceSource._id.toString(),
      );

      await authRequest('put', `${BASE_URL}/${nonExistentId}`)
        .send(mockDashboard)
        .expect(404);
    });

    it('should preserve tile IDs that match existing tiles and generate new IDs for unrecognized tiles', async () => {
      const dashboard = await createTestDashboard();
      const sourceId = traceSource._id.toString();

      // First PUT to establish a tile with a server-assigned ID
      const firstResponse = await authRequest(
        'put',
        `${BASE_URL}/${dashboard._id}`,
      )
        .send({
          name: 'Initial',
          tiles: [createTimeSeriesChart(sourceId)],
          tags: [],
        })
        .expect(200);
      const existingTileId = firstResponse.body.data.tiles[0].id;

      // Second PUT: one tile with the existing ID (should be preserved),
      // one tile with an unrecognized ID (should be replaced)
      const unknownTileId = new ObjectId().toString();
      const response = await authRequest('put', `${BASE_URL}/${dashboard._id}`)
        .send({
          name: 'Updated',
          tiles: [
            { ...createTimeSeriesChart(sourceId), id: existingTileId },
            { ...createTimeSeriesChart(sourceId), id: unknownTileId, x: 6 },
          ],
          tags: [],
        })
        .expect(200);

      expect(response.body.data.tiles[0].id).toBe(existingTileId);
      expect(response.body.data.tiles[1].id).not.toBe(unknownTileId);
      expect(typeof response.body.data.tiles[1].id).toBe('string');
      expect(response.body.data.tiles[1].id.length).toBeGreaterThan(0);
    });

    it('should preserve filter IDs that match existing filters and generate new IDs for unrecognized filters', async () => {
      const dashboard = await createTestDashboard();
      const sourceId = traceSource._id.toString();

      // First PUT to establish a filter with a server-assigned ID
      const firstResponse = await authRequest(
        'put',
        `${BASE_URL}/${dashboard._id}`,
      )
        .send({
          name: 'Initial',
          tiles: [createTimeSeriesChart(sourceId)],
          tags: [],
          filters: [
            {
              id: new ObjectId().toString(),
              type: 'QUERY_EXPRESSION' as const,
              name: 'Environment',
              expression: 'environment',
              sourceId,
            },
          ],
        })
        .expect(200);
      const existingFilterId = firstResponse.body.data.filters[0].id;

      // Second PUT: one filter with the existing ID (should be preserved),
      // one filter with an unrecognized ID (should be replaced)
      const unknownFilterId = new ObjectId().toString();
      const response = await authRequest('put', `${BASE_URL}/${dashboard._id}`)
        .send({
          name: 'Updated',
          tiles: [createTimeSeriesChart(sourceId)],
          tags: [],
          filters: [
            {
              id: existingFilterId,
              type: 'QUERY_EXPRESSION' as const,
              name: 'Environment',
              expression: 'environment',
              sourceId,
            },
            {
              id: unknownFilterId,
              type: 'QUERY_EXPRESSION' as const,
              name: 'Service',
              expression: 'service_name',
              sourceId,
            },
          ],
        })
        .expect(200);

      expect(response.body.data.filters[0].id).toBe(existingFilterId);
      expect(response.body.data.filters[1].id).not.toBe(unknownFilterId);
      expect(typeof response.body.data.filters[1].id).toBe('string');
      expect(response.body.data.filters[1].id.length).toBeGreaterThan(0);
    });

    it('can round-trip all supported chart types and all supported fields on each chart type', async () => {
      // Arrange
      const lineChart: ExternalDashboardTileWithId = {
        id: new ObjectId().toString(),
        name: 'Line Chart',
        x: 0,
        y: 0,
        w: 6,
        h: 3,
        config: {
          displayType: 'line',
          asRatio: true,
          fillNulls: true,
          fitYAxisToData: true,
          sourceId: traceSource._id.toString(),
          numberFormat: {
            output: 'time',
            factor: 0.001,
            unit: 'ms',
          },
          groupBy: 'service.name, StatusCode',
          select: [
            {
              aggFn: 'quantile',
              level: 0.95,
              valueExpression: 'Duration',
              alias: '95th Percentile Duration',
              where: "env = 'production'",
              whereLanguage: 'sql',
              numberFormat: {
                output: 'duration',
                factor: 1e-9,
              },
            },
            {
              aggFn: 'quantile',
              level: 0.99,
              valueExpression: 'Duration',
              alias: '99th Percentile Duration',
              where: 'env:production',
              whereLanguage: 'lucene',
              numberFormat: {
                output: 'duration',
                factor: 1e-9,
                mantissa: 3,
              },
            },
          ],
        },
      };

      const barChart: ExternalDashboardTileWithId = {
        id: new ObjectId().toString(),
        name: 'Bar Chart',
        x: 6,
        y: 0,
        w: 6,
        h: 3,
        config: {
          displayType: 'stacked_bar',
          asRatio: false,
          fillNulls: false,
          sourceId: metricSource._id.toString(),
          numberFormat: {
            output: 'byte',
            decimalBytes: true,
            mantissa: 0,
          },
          select: [
            {
              aggFn: 'quantile',
              level: 0.95,
              valueExpression: 'Duration',
              metricName: 'ClickHouseAsyncMetrics_BlockWriteBytes_ram1',
              metricType: MetricsDataType.Gauge,
              alias: '95th Percentile Duration',
              where: "env = 'production'",
              whereLanguage: 'sql',
            },
          ],
        },
      };

      const tableChart: ExternalDashboardTileWithId = {
        id: new ObjectId().toString(),
        name: 'Table Chart',
        x: 12,
        y: 0,
        w: 6,
        h: 3,
        config: {
          displayType: 'table',
          asRatio: false,
          sourceId: traceSource._id.toString(),
          select: [
            {
              aggFn: 'quantile',
              level: 0.5,
              valueExpression: 'Duration',
              alias: 'Median Duration',
              where: "env = 'production'",
              whereLanguage: 'sql',
              numberFormat: {
                output: 'duration',
                factor: 1e-9,
              },
            },
            {
              aggFn: 'quantile',
              level: 0.99,
              valueExpression: 'Duration',
              alias: '99th Percentile Duration',
              where: "env = 'production'",
              whereLanguage: 'sql',
            },
          ],
          groupBy: 'service.name',
          orderBy: 'service.name desc',
          having: 'percentiles(Duration, 0.5) > 100',
          numberFormat: {
            output: 'percent',
            mantissa: 2,
            thousandSeparated: true,
            average: true,
          },
          groupByColumnsOnLeft: true,
          onClick: {
            type: 'search',
            target: {
              mode: 'id',
              id: traceSource._id.toString(),
            },
            whereLanguage: 'sql',
            whereTemplate: "ServiceName = '{{service.name}}'",
          },
        },
      };

      const numberChart: ExternalDashboardTileWithId = {
        id: new ObjectId().toString(),
        name: 'Number Chart',
        x: 18,
        y: 0,
        w: 6,
        h: 3,
        config: {
          displayType: 'number',
          sourceId: traceSource._id.toString(),
          select: [
            {
              aggFn: 'quantile',
              level: 0.5,
              valueExpression: 'Duration',
              alias: '50th Percentile Duration',
              where: "env = 'production'",
              whereLanguage: 'sql',
              numberFormat: {
                output: 'duration',
                factor: 1e-9,
              },
            },
          ],
          numberFormat: {
            output: 'percent',
            mantissa: 2,
            thousandSeparated: true,
            average: true,
          },
          color: 'chart-green',
          colorRules: [
            {
              operator: 'gt',
              value: 1000,
              color: 'chart-warning',
              label: 'Slow',
            },
            {
              operator: 'between',
              value: [200, 1000],
              color: 'chart-blue',
            },
            {
              operator: 'gte',
              value: 5000,
              color: 'chart-error',
              label: 'Critical',
            },
          ],
        },
      };

      const markdownChart: ExternalDashboardTileWithId = {
        id: new ObjectId().toString(),
        name: 'Markdown Chart',
        x: 0,
        y: 3,
        w: 6,
        h: 3,
        config: {
          displayType: 'markdown',
          markdown: '# Markdown Content',
        },
      };

      const heatmapChart: ExternalDashboardTileWithId = {
        id: new ObjectId().toString(),
        name: 'Heatmap Chart',
        x: 6,
        y: 3,
        w: 6,
        h: 3,
        config: {
          displayType: 'heatmap',
          sourceId: traceSource._id.toString(),
          select: [
            {
              valueExpression: 'Duration',
              countExpression: 'count()',
              heatmapScaleType: 'linear',
            },
          ],
          where: 'service:api',
          whereLanguage: 'lucene',
          numberFormat: {
            output: 'time',
            factor: 0.001,
            unit: 'ms',
          },
        },
      };

      // Create an initial dashboard to update
      const initialDashboard = await createTestDashboard();

      // Act
      const response = await authRequest(
        'put',
        `${BASE_URL}/${initialDashboard._id}`,
      )
        .send({
          name: 'Dashboard with All Chart Types',
          tiles: [
            lineChart,
            barChart,
            tableChart,
            numberChart,
            markdownChart,
            heatmapChart,
          ],
          tags: ['round-trip-test'],
        })
        .expect(200);

      // Assert response matches input (tile IDs are server-generated since the dashboard was empty)
      expect(omit(response.body.data.tiles[0], ['id'])).toEqual(
        omit(lineChart, ['id']),
      );
      expect(omit(response.body.data.tiles[1], ['id'])).toEqual(
        omit(barChart, ['id']),
      );
      expect(omit(response.body.data.tiles[2], ['id'])).toEqual(
        omit(tableChart, ['id']),
      );
      expect(omit(response.body.data.tiles[3], ['id'])).toEqual(
        omit(numberChart, ['id']),
      );
      expect(omit(response.body.data.tiles[4], ['id'])).toEqual(
        omit(markdownChart, ['id']),
      );
      expect(omit(response.body.data.tiles[5], ['id'])).toEqual(
        omit(heatmapChart, ['id']),
      );
    });

    it('can round-trip all raw SQL chart config types', async () => {
      const connectionId = connection._id.toString();
      const sourceId = traceSource._id.toString();
      const sqlTemplate = 'SELECT count() FROM otel_logs WHERE {timeFilter}';

      const lineRawSql: ExternalDashboardTileWithId = {
        id: new ObjectId().toString(),
        name: 'Line Raw SQL',
        x: 0,
        y: 0,
        w: 6,
        h: 3,
        config: {
          configType: 'sql',
          displayType: 'line',
          connectionId,
          sqlTemplate,
          sourceId,
          compareToPreviousPeriod: true,
          fillNulls: true,
          alignDateRangeToGranularity: true,
          fitYAxisToData: true,
          numberFormat: { output: 'number', mantissa: 2 },
        },
      };

      const barRawSql: ExternalDashboardTileWithId = {
        id: new ObjectId().toString(),
        name: 'Bar Raw SQL',
        x: 6,
        y: 0,
        w: 6,
        h: 3,
        config: {
          configType: 'sql',
          displayType: 'stacked_bar',
          connectionId,
          sqlTemplate,
          sourceId,
          fillNulls: false,
          alignDateRangeToGranularity: false,
          numberFormat: { output: 'byte', decimalBytes: true },
        },
      };

      const tableRawSql: ExternalDashboardTileWithId = {
        id: new ObjectId().toString(),
        name: 'Table Raw SQL',
        x: 0,
        y: 3,
        w: 6,
        h: 3,
        config: {
          configType: 'sql',
          displayType: 'table',
          connectionId,
          sqlTemplate,
          sourceId,
          numberFormat: { output: 'percent', mantissa: 1 },
          onClick: {
            type: 'dashboard',
            target: {
              mode: 'template',
              template: '{{dashboardName}}',
            },
            whereLanguage: 'lucene',
          },
        },
      };

      const numberRawSql: ExternalDashboardTileWithId = {
        id: new ObjectId().toString(),
        name: 'Number Raw SQL',
        x: 6,
        y: 3,
        w: 6,
        h: 3,
        config: {
          configType: 'sql',
          displayType: 'number',
          connectionId,
          sqlTemplate,
          sourceId,
          numberFormat: { output: 'currency', currencySymbol: '$' },
          // Raw SQL number tiles carry the static tile color (no colorRules).
          color: 'chart-purple',
        },
      };

      const pieRawSql: ExternalDashboardTileWithId = {
        id: new ObjectId().toString(),
        name: 'Pie Raw SQL',
        x: 12,
        y: 3,
        w: 6,
        h: 3,
        config: {
          configType: 'sql',
          displayType: 'pie',
          connectionId,
          sqlTemplate,
          sourceId,
        },
      };

      const initialDashboard = await createTestDashboard();

      const response = await authRequest(
        'put',
        `${BASE_URL}/${initialDashboard._id}`,
      )
        .send({
          name: 'Dashboard with Raw SQL Chart Types',
          tiles: [lineRawSql, barRawSql, tableRawSql, numberRawSql, pieRawSql],
          tags: ['raw-sql-test'],
        })
        .expect(200);

      expect(omit(response.body.data.tiles[0], ['id'])).toEqual(
        omit(lineRawSql, ['id']),
      );
      expect(omit(response.body.data.tiles[1], ['id'])).toEqual(
        omit(barRawSql, ['id']),
      );
      expect(omit(response.body.data.tiles[2], ['id'])).toEqual(
        omit(tableRawSql, ['id']),
      );
      expect(omit(response.body.data.tiles[3], ['id'])).toEqual(
        omit(numberRawSql, ['id']),
      );
      expect(omit(response.body.data.tiles[4], ['id'])).toEqual(
        omit(pieRawSql, ['id']),
      );
    });

    it('should return 400 when source IDs do not exist', async () => {
      const dashboard = await createTestDashboard();
      const nonExistentSourceId = new ObjectId().toString();
      const updatedDashboard = createMockDashboardWithIds(nonExistentSourceId, {
        name: 'Updated Dashboard Name',
      });

      const response = await authRequest('put', `${BASE_URL}/${dashboard._id}`)
        .send(updatedDashboard)
        .expect(400);

      expect(response.body).toEqual({
        message: `Could not find the following source IDs: ${nonExistentSourceId}`,
      });
    });

    it('should return 400 when connection ID does not belong to the team', async () => {
      const dashboard = await createTestDashboard();
      const otherTeamConnection = await Connection.create({
        team: new ObjectId(),
        name: 'Other Team Connection',
        host: config.CLICKHOUSE_HOST,
        username: config.CLICKHOUSE_USER,
        password: config.CLICKHOUSE_PASSWORD,
      });
      const otherConnectionId = otherTeamConnection._id.toString();

      const response = await authRequest('put', `${BASE_URL}/${dashboard._id}`)
        .send({
          name: 'Updated Dashboard with Foreign Connection',
          tiles: [
            {
              id: new ObjectId().toString(),
              name: 'Raw SQL Tile',
              x: 0,
              y: 0,
              w: 6,
              h: 3,
              config: {
                configType: 'sql',
                displayType: 'line',
                connectionId: otherConnectionId,
                sqlTemplate: 'SELECT count() FROM otel_logs WHERE {timeFilter}',
              },
            },
          ],
          tags: [],
        })
        .expect(400);

      expect(response.body).toEqual({
        message: `Could not find the following connection IDs: ${otherConnectionId}`,
      });
    });

    it('should return 400 when source connection does not match tile connection', async () => {
      const dashboard = await createTestDashboard();
      const otherConnection = await Connection.create({
        team: team._id,
        name: 'Other Connection',
        host: config.CLICKHOUSE_HOST,
        username: config.CLICKHOUSE_USER,
        password: config.CLICKHOUSE_PASSWORD,
      });

      const response = await authRequest('put', `${BASE_URL}/${dashboard._id}`)
        .send({
          name: 'Updated Dashboard with Mismatched Source Connection',
          tiles: [
            {
              id: new ObjectId().toString(),
              name: 'Raw SQL Tile',
              x: 0,
              y: 0,
              w: 6,
              h: 3,
              config: {
                configType: 'sql',
                displayType: 'table',
                connectionId: otherConnection._id.toString(),
                sourceId: traceSource._id.toString(),
                sqlTemplate: 'SELECT count() FROM otel_logs',
              },
            },
          ],
          tags: [],
        })
        .expect(400);

      expect(response.body).toEqual({
        message: `The following source IDs do not match the specified connections: ${traceSource._id.toString()}`,
      });
    });

    it('should return 400 on update when a table tile onClick references a non-existent dashboard', async () => {
      const dashboard = await createTestDashboard();
      const nonExistentDashboardId = new ObjectId().toString();

      const response = await authRequest('put', `${BASE_URL}/${dashboard._id}`)
        .send({
          name: 'Updated Dashboard',
          tiles: [
            {
              id: new ObjectId().toString(),
              name: 'Table Chart',
              x: 0,
              y: 0,
              w: 6,
              h: 3,
              config: {
                displayType: 'table',
                sourceId: traceSource._id.toString(),
                select: [{ aggFn: 'count' }],
                onClick: {
                  type: 'dashboard',
                  target: { mode: 'id', id: nonExistentDashboardId },
                  whereLanguage: 'sql',
                },
              },
            },
          ],
          tags: [],
        })
        .expect(400);

      expect(response.body).toEqual({
        message: `Could not find the following onClick dashboard IDs: ${nonExistentDashboardId}`,
      });
    });

    it('should return 400 on update when a table tile onClick references a non-existent source', async () => {
      const dashboard = await createTestDashboard();
      const nonExistentSourceId = new ObjectId().toString();

      const response = await authRequest('put', `${BASE_URL}/${dashboard._id}`)
        .send({
          name: 'Updated Dashboard',
          tiles: [
            {
              id: new ObjectId().toString(),
              name: 'Table Chart',
              x: 0,
              y: 0,
              w: 6,
              h: 3,
              config: {
                displayType: 'table',
                sourceId: traceSource._id.toString(),
                select: [{ aggFn: 'count' }],
                onClick: {
                  type: 'search',
                  target: { mode: 'id', id: nonExistentSourceId },
                  whereLanguage: 'sql',
                },
              },
            },
          ],
          tags: [],
        })
        .expect(400);

      expect(response.body).toEqual({
        message: `Could not find the following source IDs: ${nonExistentSourceId}`,
      });
    });

    it('should delete alert when tile is updated from builder to raw SQL config and the display type does not support alerts', async () => {
      const tileId = new ObjectId().toString();
      const dashboard = await createTestDashboard({
        tiles: [
          {
            id: tileId,
            name: 'Builder Tile',
            x: 0,
            y: 0,
            w: 6,
            h: 3,
            config: {
              displayType: 'number',
              source: traceSource._id.toString(),
              select: [
                {
                  aggFn: 'count',
                  aggCondition: '',
                  aggConditionLanguage: 'lucene',
                  valueExpression: '',
                },
              ],
              where: '',
              whereLanguage: 'lucene',
              granularity: 'auto',
              implicitColumnExpression: 'Body',
              filters: [],
            },
          },
        ],
      });

      const webhook = await Webhook.create({
        name: 'Test Webhook',
        service: WebhookService.Slack,
        url: 'https://hooks.slack.com/test',
        team: team._id,
      });

      // Create a standalone alert for the builder tile
      const alert = await Alert.create({
        team: team._id,
        dashboard: dashboard._id,
        tileId,
        source: AlertSource.TILE,
        threshold: 100,
        interval: '1h',
        thresholdType: AlertThresholdType.ABOVE,
        channel: { type: 'webhook', webhookId: webhook._id.toString() },
      });

      expect(await Alert.findById(alert._id)).not.toBeNull();

      // Update the tile to raw SQL config (same tile ID)
      await authRequest('put', `${BASE_URL}/${dashboard._id}`)
        .send({
          name: 'Updated Dashboard',
          tags: [],
          tiles: [
            {
              id: tileId,
              name: 'Raw SQL Tile',
              x: 0,
              y: 0,
              w: 6,
              h: 3,
              config: {
                configType: 'sql',
                displayType: 'table',
                connectionId: connection._id.toString(),
                sqlTemplate: 'SELECT count() FROM otel_logs WHERE {timeFilter}',
              },
            },
          ],
        })
        .expect(200);

      expect(await Alert.findById(alert._id)).toBeNull();
    });

    it('should delete alert when a tile with an alert is removed from the dashboard', async () => {
      const keepTileId = new ObjectId().toString();
      const removeTileId = new ObjectId().toString();
      const dashboard = await createTestDashboard({
        tiles: [
          {
            id: keepTileId,
            name: 'Keep Tile',
            x: 0,
            y: 0,
            w: 6,
            h: 3,
            config: {
              displayType: 'line',
              source: traceSource._id.toString(),
              select: [
                {
                  aggFn: 'count',
                  aggCondition: '',
                  aggConditionLanguage: 'lucene',
                  valueExpression: '',
                },
              ],
              where: '',
              whereLanguage: 'lucene',
              granularity: 'auto',
              implicitColumnExpression: 'Body',
              filters: [],
            },
          },
          {
            id: removeTileId,
            name: 'Remove Tile',
            x: 6,
            y: 0,
            w: 6,
            h: 3,
            config: {
              displayType: 'line',
              source: traceSource._id.toString(),
              select: [
                {
                  aggFn: 'count',
                  aggCondition: '',
                  aggConditionLanguage: 'lucene',
                  valueExpression: '',
                },
              ],
              where: '',
              whereLanguage: 'lucene',
              granularity: 'auto',
              implicitColumnExpression: 'Body',
              filters: [],
            },
          },
        ],
      });

      const webhook = await Webhook.create({
        name: 'Test Webhook',
        service: WebhookService.Slack,
        url: 'https://hooks.slack.com/test',
        team: team._id,
      });

      const alert = await Alert.create({
        team: team._id,
        dashboard: dashboard._id,
        tileId: removeTileId,
        source: AlertSource.TILE,
        threshold: 100,
        interval: '1h',
        thresholdType: AlertThresholdType.ABOVE,
        channel: { type: 'webhook', webhookId: webhook._id.toString() },
      });

      expect(await Alert.findById(alert._id)).not.toBeNull();

      // Update the dashboard, omitting the tile that had an alert
      await authRequest('put', `${BASE_URL}/${dashboard._id}`)
        .send({
          name: 'Updated Dashboard',
          tags: [],
          tiles: [
            {
              id: keepTileId,
              name: 'Keep Tile',
              x: 0,
              y: 0,
              w: 6,
              h: 3,
              config: {
                displayType: 'line',
                sourceId: traceSource._id.toString(),
                select: [{ aggFn: 'count', where: '' }],
              },
            },
          ],
        })
        .expect(200);

      expect(await Alert.findById(alert._id)).toBeNull();
    });

    it('does not re-validate heatmap source-kind for unchanged heatmap tiles', async () => {
      // Create a dashboard with a heatmap on a valid Trace source.
      const heatmapTileId = new ObjectId().toString();
      const otherTileId = new ObjectId().toString();
      const createResponse = await authRequest('post', BASE_URL)
        .send({
          name: 'Heatmap PUT scoping test',
          tiles: [
            {
              id: heatmapTileId,
              name: 'Latency Heatmap',
              x: 0,
              y: 0,
              w: 6,
              h: 3,
              config: {
                displayType: 'heatmap',
                sourceId: traceSource._id.toString(),
                select: [
                  {
                    valueExpression: 'Duration',
                  },
                ],
              },
            },
            {
              id: otherTileId,
              name: 'Other line tile',
              x: 6,
              y: 0,
              w: 6,
              h: 3,
              config: {
                displayType: 'line',
                sourceId: traceSource._id.toString(),
                select: [{ aggFn: 'count', where: '' }],
              },
            },
          ],
          tags: [],
        })
        .expect(200);

      const dashboardId = createResponse.body.data.id;
      // The created tile id surfaces server-generated when not present
      // in the existing dashboard, so capture the actual id from the
      // response for the PUT echo.
      const createdHeatmapTile = createResponse.body.data.tiles.find(
        (t: { name: string }) => t.name === 'Latency Heatmap',
      );
      const createdOtherTile = createResponse.body.data.tiles.find(
        (t: { name: string }) => t.name === 'Other line tile',
      );

      // Simulate the source's kind being changed to non-Trace AFTER
      // the dashboard was originally accepted. The bypass writes to
      // the raw collection because the discriminator-aware
      // `updateSource` controller would Reject the kind change due to
      // schema diffs. The behaviour we care about is that subsequent
      // PUTs on the dashboard don't wedge on the now-incompatible
      // source as long as the heatmap tile itself was not changed.
      await Source.collection.updateOne(
        { _id: traceSource._id },
        { $set: { kind: SourceKind.Log } },
      );

      // PUT the dashboard back with the heatmap tile unchanged but a
      // different non-heatmap tile edit. Should still succeed.
      await authRequest('put', `${BASE_URL}/${dashboardId}`)
        .send({
          name: 'Heatmap PUT scoping test - renamed',
          tiles: [
            {
              id: createdHeatmapTile.id,
              name: 'Latency Heatmap',
              x: 0,
              y: 0,
              w: 6,
              h: 3,
              config: {
                displayType: 'heatmap',
                sourceId: traceSource._id.toString(),
                select: [
                  {
                    valueExpression: 'Duration',
                  },
                ],
              },
            },
            {
              id: createdOtherTile.id,
              name: 'Other line tile, edited',
              x: 6,
              y: 0,
              w: 6,
              h: 3,
              config: {
                displayType: 'line',
                sourceId: traceSource._id.toString(),
                select: [{ aggFn: 'count', where: 'level:error' }],
              },
            },
          ],
          tags: [],
        })
        .expect(200);
    });
  });

  describe('Number tile color (HDX-1360)', () => {
    // Minimal builder number tile; callers supply color / colorRules. The
    // payload is sent through `.send()` (untyped) so negative tests can post
    // intentionally invalid values without tripping the compile-time schema.
    const numberTile = (config: Record<string, unknown>) => ({
      name: 'Number',
      x: 0,
      y: 0,
      w: 3,
      h: 3,
      config: {
        displayType: 'number',
        sourceId: traceSource._id.toString(),
        select: [{ aggFn: 'count', where: '' }],
        ...config,
      },
    });

    const postTile = (config: Record<string, unknown>) =>
      authRequest('post', BASE_URL).send({
        name: 'Number color dashboard',
        tiles: [numberTile(config)],
        tags: [],
      });

    const rawSqlNumberTile = (config: Record<string, unknown>) => ({
      name: 'Number Raw SQL',
      x: 0,
      y: 0,
      w: 3,
      h: 3,
      config: {
        configType: 'sql',
        displayType: 'number',
        connectionId: connection._id.toString(),
        sqlTemplate: 'SELECT count() FROM otel_logs WHERE {timeFilter}',
        sourceId: traceSource._id.toString(),
        ...config,
      },
    });

    // ── Positive: one per UI input ──────────────────────────────────────

    it('round-trips a builder number tile with a static color', async () => {
      const create = await postTile({ color: 'chart-red' }).expect(200);
      expect(create.body.data.tiles[0].config.color).toBe('chart-red');

      const get = await authRequest(
        'get',
        `${BASE_URL}/${create.body.data.id}`,
      ).expect(200);
      expect(get.body.data.tiles[0].config.color).toBe('chart-red');
    });

    it('round-trips colorRules covering each operator family', async () => {
      const colorRules = [
        { operator: 'gt', value: 1000, color: 'chart-warning', label: 'Slow' },
        {
          operator: 'gte',
          value: 5000,
          color: 'chart-error',
          label: 'Critical',
        },
        { operator: 'lt', value: 0, color: 'chart-gray' },
        { operator: 'lte', value: 10, color: 'chart-purple' },
        { operator: 'between', value: [200, 1000], color: 'chart-blue' },
        { operator: 'eq', value: 0, color: 'chart-cyan' },
        { operator: 'neq', value: 'OK', color: 'chart-success' },
      ];
      const create = await postTile({ colorRules }).expect(200);
      expect(create.body.data.tiles[0].config.colorRules).toEqual(colorRules);

      const get = await authRequest(
        'get',
        `${BASE_URL}/${create.body.data.id}`,
      ).expect(200);
      expect(get.body.data.tiles[0].config.colorRules).toEqual(colorRules);
    });

    it('round-trips a raw SQL number tile with a static color', async () => {
      const create = await authRequest('post', BASE_URL)
        .send({
          name: 'Raw SQL number color',
          tiles: [rawSqlNumberTile({ color: 'chart-blue' })],
          tags: [],
        })
        .expect(200);
      expect(create.body.data.tiles[0].config.color).toBe('chart-blue');

      const get = await authRequest(
        'get',
        `${BASE_URL}/${create.body.data.id}`,
      ).expect(200);
      expect(get.body.data.tiles[0].config.color).toBe('chart-blue');
    });

    it('round-trips color and colorRules through an update (PUT)', async () => {
      const created = await postTile({}).expect(200);
      const dashboardId = created.body.data.id;
      const tile = created.body.data.tiles[0];

      const colorRules = [
        {
          operator: 'gte',
          value: 5000,
          color: 'chart-error',
          label: 'Critical',
        },
        { operator: 'between', value: [200, 1000], color: 'chart-blue' },
      ];
      const update = await authRequest('put', `${BASE_URL}/${dashboardId}`)
        .send({
          name: 'Number color dashboard',
          tiles: [
            {
              ...tile,
              config: { ...tile.config, color: 'chart-red', colorRules },
            },
          ],
          tags: [],
        })
        .expect(200);
      expect(update.body.data.tiles[0].config).toMatchObject({
        color: 'chart-red',
        colorRules,
      });

      const get = await authRequest('get', `${BASE_URL}/${dashboardId}`).expect(
        200,
      );
      expect(get.body.data.tiles[0].config).toMatchObject({
        color: 'chart-red',
        colorRules,
      });
    });

    it('strips colorRules from a raw SQL number tile, keeping color', async () => {
      const create = await authRequest('post', BASE_URL)
        .send({
          name: 'Raw SQL colorRules',
          tiles: [
            rawSqlNumberTile({
              color: 'chart-blue',
              colorRules: [{ operator: 'gt', value: 1, color: 'chart-red' }],
            }),
          ],
          tags: [],
        })
        .expect(200);
      expect(create.body.data.tiles[0].config.color).toBe('chart-blue');
      expect(create.body.data.tiles[0].config.colorRules).toBeUndefined();
    });

    // ── Negative: one per schema rejection rule ─────────────────────────

    it('rejects a static color that is not a palette token', async () => {
      const res = await postTile({ color: 'red' }).expect(400);
      expect(res.body.message).toContain('tiles.0.config.color');
      await postTile({ color: 'chart-99' }).expect(400);
      await postTile({ color: '#ff0000' }).expect(400);
    });

    it('rejects a legacy numeric palette token on input', async () => {
      // chart-1..chart-10 were renamed to hue names; the input enum is
      // strict hue-only, so a legacy token in a hand-written payload is
      // rejected. Legacy tokens are normalized on read, never accepted on
      // write.
      await postTile({ color: 'chart-1' }).expect(400);
    });

    it('rejects more than 10 colorRules', async () => {
      const colorRules = Array.from({ length: 11 }, (_, i) => ({
        operator: 'gt',
        value: i,
        color: 'chart-blue',
      }));
      const res = await postTile({ colorRules }).expect(400);
      expect(res.body.message).toContain('tiles.0.config.colorRules');
    });

    it('rejects a between rule whose value is not a two-number tuple', async () => {
      await postTile({
        colorRules: [{ operator: 'between', value: 100, color: 'chart-blue' }],
      }).expect(400);
    });

    it('rejects a numeric operator rule with a string value', async () => {
      await postTile({
        colorRules: [{ operator: 'gt', value: 'high', color: 'chart-blue' }],
      }).expect(400);
    });

    it('rejects operators the number-tile editor never emits', async () => {
      for (const operator of ['contains', 'startsWith', 'endsWith', 'regex']) {
        const res = await postTile({
          colorRules: [{ operator, value: 'error', color: 'chart-blue' }],
        }).expect(400);
        expect(res.body.message).toContain('tiles.0.config.colorRules');
      }
    });

    it('rejects a per-rule color that is not a palette token', async () => {
      const res = await postTile({
        colorRules: [{ operator: 'gt', value: 1, color: 'red' }],
      }).expect(400);
      expect(res.body.message).toContain('tiles.0.config.colorRules');
      // Legacy numeric tokens are normalized on read, never accepted on write.
      await postTile({
        colorRules: [{ operator: 'gt', value: 1, color: 'chart-1' }],
      }).expect(400);
    });

    it('rejects a rule label longer than 40 characters', async () => {
      await postTile({
        colorRules: [
          {
            operator: 'gt',
            value: 1,
            color: 'chart-blue',
            label: 'x'.repeat(41),
          },
        ],
      }).expect(400);
    });

    // ── Backward compatibility: existing dashboards keep working ────────

    it('round-trips a number tile with neither color nor colorRules', async () => {
      const create = await postTile({}).expect(200);
      expect(create.body.data.tiles[0].config.color).toBeUndefined();
      expect(create.body.data.tiles[0].config.colorRules).toBeUndefined();
    });

    it('normalizes a legacy numeric token on a builder number tile to its hue name on read', async () => {
      const create = await postTile({ color: 'chart-green' }).expect(200);
      const dashboardId = create.body.data.id;

      // Simulate a tile saved during the #2265 window by writing a legacy
      // numeric token directly to Mongo (the `tiles` field is `Mixed`, so
      // this bypasses the create-path enum).
      await Dashboard.updateOne(
        { _id: dashboardId },
        { $set: { 'tiles.0.config.color': 'chart-1' } },
      );

      const get = await authRequest('get', `${BASE_URL}/${dashboardId}`).expect(
        200,
      );
      // chart-1 maps to chart-green (LEGACY_CHART_PALETTE_TOKEN_MAP).
      expect(get.body.data.tiles[0].config.color).toBe('chart-green');
    });

    it('normalizes legacy colorRule colors and drops unresolvable ones on read', async () => {
      const create = await postTile({
        colorRules: [{ operator: 'gt', value: 1, color: 'chart-green' }],
      }).expect(200);
      const dashboardId = create.body.data.id;

      // Direct Mongo write: a legacy numeric token (normalized to its hue
      // name on read) and an unrecognized token (dropped on read so the
      // response stays within the palette-token enum). Neither is reachable
      // through the validated create path.
      await Dashboard.updateOne(
        { _id: dashboardId },
        {
          $set: {
            'tiles.0.config.colorRules': [
              { operator: 'gt', value: 1, color: 'chart-1' },
              { operator: 'gt', value: 2, color: 'not-a-token' },
            ],
          },
        },
      );

      const get = await authRequest('get', `${BASE_URL}/${dashboardId}`).expect(
        200,
      );
      // chart-1 maps to chart-green; the unresolvable rule is dropped.
      expect(get.body.data.tiles[0].config.colorRules).toEqual([
        { operator: 'gt', value: 1, color: 'chart-green' },
      ]);
    });

    it('omits colorRules when every stored rule color is unresolvable on read', async () => {
      const create = await postTile({
        colorRules: [{ operator: 'gt', value: 1, color: 'chart-green' }],
      }).expect(200);
      const dashboardId = create.body.data.id;

      // Direct Mongo write of an unresolvable token (not reachable via the
      // validated create path); the only rule drops, so the field is omitted
      // rather than returned as an empty array.
      await Dashboard.updateOne(
        { _id: dashboardId },
        {
          $set: {
            'tiles.0.config.colorRules': [
              { operator: 'gt', value: 1, color: 'not-a-token' },
            ],
          },
        },
      );

      const get = await authRequest('get', `${BASE_URL}/${dashboardId}`).expect(
        200,
      );
      expect(get.body.data.tiles[0].config.colorRules).toBeUndefined();
    });

    it('normalizes a legacy numeric token on a raw SQL number tile to its hue name on read', async () => {
      const create = await authRequest('post', BASE_URL)
        .send({
          name: 'Raw SQL legacy color',
          tiles: [rawSqlNumberTile({ color: 'chart-blue' })],
          tags: [],
        })
        .expect(200);
      const dashboardId = create.body.data.id;

      await Dashboard.updateOne(
        { _id: dashboardId },
        { $set: { 'tiles.0.config.color': 'chart-4' } },
      );

      const get = await authRequest('get', `${BASE_URL}/${dashboardId}`).expect(
        200,
      );
      // chart-4 maps to chart-red.
      expect(get.body.data.tiles[0].config.color).toBe('chart-red');
    });
  });

  describe('Containers and tabs', () => {
    const buildTile = (
      sourceId: string,
      overrides: Partial<ExternalDashboardTileWithId> = {},
    ): ExternalDashboardTileWithId => ({
      id: new ObjectId().toString(),
      name: 'Tile',
      x: 0,
      y: 0,
      w: 6,
      h: 3,
      config: {
        displayType: 'line',
        sourceId,
        select: [{ aggFn: 'count', where: '' }],
      },
      ...overrides,
    });

    it('round-trips containers, tabs, and tile containerId/tabId on create and update', async () => {
      const sourceId = traceSource._id.toString();
      const groupedTabA = buildTile(sourceId, {
        name: 'In Group, Tab A',
        containerId: 'service-health',
        tabId: 'errors',
      });
      const groupedTabB = buildTile(sourceId, {
        name: 'In Group, Tab B',
        containerId: 'service-health',
        tabId: 'latency',
      });
      const groupedNoTab = buildTile(sourceId, {
        name: 'In Plain Group',
        containerId: 'overview',
      });
      const ungrouped = buildTile(sourceId, { name: 'Ungrouped' });

      const containers = [
        {
          id: 'service-health',
          title: 'Service Health',
          collapsed: false,
          collapsible: true,
          bordered: true,
          tabs: [
            { id: 'errors', title: 'Errors' },
            { id: 'latency', title: 'Latency' },
          ],
        },
        {
          id: 'overview',
          title: 'Overview',
          collapsed: true,
        },
      ];

      const createResponse = await authRequest('post', BASE_URL)
        .send({
          name: 'Containers Round-Trip',
          tiles: [groupedTabA, groupedTabB, groupedNoTab, ungrouped],
          tags: ['containers-test'],
          containers,
        })
        .expect(200);

      expect(createResponse.body.data.containers).toEqual(containers);
      const createdTilesByName = Object.fromEntries(
        createResponse.body.data.tiles.map((t: ExternalDashboardTileWithId) => [
          t.name,
          t,
        ]),
      );
      expect(createdTilesByName['In Group, Tab A']).toMatchObject({
        containerId: 'service-health',
        tabId: 'errors',
      });
      expect(createdTilesByName['In Group, Tab B']).toMatchObject({
        containerId: 'service-health',
        tabId: 'latency',
      });
      expect(createdTilesByName['In Plain Group']).toMatchObject({
        containerId: 'overview',
      });
      expect(createdTilesByName['In Plain Group'].tabId).toBeUndefined();
      expect(createdTilesByName.Ungrouped.containerId).toBeUndefined();
      expect(createdTilesByName.Ungrouped.tabId).toBeUndefined();

      const dashboardId = createResponse.body.data.id;

      const getResponse = await authRequest(
        'get',
        `${BASE_URL}/${dashboardId}`,
      ).expect(200);
      expect(getResponse.body.data.containers).toEqual(containers);

      // Update: rename a tab, drop the second container, re-home tiles.
      const updatedContainers = [
        {
          id: 'service-health',
          title: 'Service Health',
          collapsed: true,
          tabs: [
            { id: 'errors', title: 'Error Rate' },
            { id: 'latency', title: 'Latency' },
          ],
        },
      ];
      const reHomedUngrouped = {
        ...createdTilesByName.Ungrouped,
        containerId: 'service-health',
        tabId: 'errors',
      };
      const droppedContainerTile = {
        ...createdTilesByName['In Plain Group'],
        containerId: undefined,
        tabId: undefined,
      };

      const updateResponse = await authRequest(
        'put',
        `${BASE_URL}/${dashboardId}`,
      )
        .send({
          name: 'Containers Round-Trip',
          tiles: [
            createdTilesByName['In Group, Tab A'],
            createdTilesByName['In Group, Tab B'],
            droppedContainerTile,
            reHomedUngrouped,
          ],
          tags: ['containers-test'],
          containers: updatedContainers,
        })
        .expect(200);

      expect(updateResponse.body.data.containers).toEqual(updatedContainers);
      const updatedTilesByName = Object.fromEntries(
        updateResponse.body.data.tiles.map((t: ExternalDashboardTileWithId) => [
          t.name,
          t,
        ]),
      );
      expect(updatedTilesByName['In Plain Group'].containerId).toBeUndefined();
      expect(updatedTilesByName.Ungrouped).toMatchObject({
        containerId: 'service-health',
        tabId: 'errors',
      });
    });

    it('round-trips a container with no optional fields set', async () => {
      const sourceId = traceSource._id.toString();
      const containers = [
        {
          id: 'minimal',
          title: 'Minimal',
          collapsed: false,
        },
      ];

      const response = await authRequest('post', BASE_URL)
        .send({
          name: 'Minimal Container Dashboard',
          tiles: [buildTile(sourceId)],
          tags: [],
          containers,
        })
        .expect(200);

      expect(response.body.data.containers).toEqual(containers);
      const [container] = response.body.data.containers;
      expect(container.collapsible).toBeUndefined();
      expect(container.bordered).toBeUndefined();
      expect(container.tabs).toBeUndefined();
    });

    it('rejects a tile that references an unknown containerId', async () => {
      const sourceId = traceSource._id.toString();
      const response = await authRequest('post', BASE_URL)
        .send({
          name: 'Bad Container Reference',
          tiles: [buildTile(sourceId, { containerId: 'does-not-exist' })],
          tags: [],
          containers: [
            { id: 'real-container', title: 'Real', collapsed: false },
          ],
        })
        .expect(400);

      expect(response.body.message).toContain(
        'unknown containerId "does-not-exist"',
      );
    });

    it('rejects a tile that references an unknown tabId', async () => {
      const sourceId = traceSource._id.toString();
      const response = await authRequest('post', BASE_URL)
        .send({
          name: 'Bad Tab Reference',
          tiles: [
            buildTile(sourceId, {
              containerId: 'service-health',
              tabId: 'ghost',
            }),
          ],
          tags: [],
          containers: [
            {
              id: 'service-health',
              title: 'Service Health',
              collapsed: false,
              tabs: [{ id: 'errors', title: 'Errors' }],
            },
          ],
        })
        .expect(400);

      expect(response.body.message).toContain('unknown tabId "ghost"');
    });

    it('rejects a tile that supplies tabId without containerId', async () => {
      const sourceId = traceSource._id.toString();
      const response = await authRequest('post', BASE_URL)
        .send({
          name: 'Tab Without Container',
          tiles: [buildTile(sourceId, { tabId: 'errors' })],
          tags: [],
          containers: [
            {
              id: 'service-health',
              title: 'Service Health',
              collapsed: false,
              tabs: [{ id: 'errors', title: 'Errors' }],
            },
          ],
        })
        .expect(400);

      expect(response.body.message).toContain(
        'tabId requires containerId to be set',
      );
    });

    it('rejects duplicate container ids', async () => {
      const sourceId = traceSource._id.toString();
      const response = await authRequest('post', BASE_URL)
        .send({
          name: 'Duplicate Containers',
          tiles: [buildTile(sourceId)],
          tags: [],
          containers: [
            { id: 'dupe', title: 'A', collapsed: false },
            { id: 'dupe', title: 'B', collapsed: false },
          ],
        })
        .expect(400);

      expect(response.body.message).toContain('Container IDs must be unique');
    });

    it('rejects duplicate tab ids within a container', async () => {
      const sourceId = traceSource._id.toString();
      const response = await authRequest('post', BASE_URL)
        .send({
          name: 'Duplicate Tabs',
          tiles: [buildTile(sourceId)],
          tags: [],
          containers: [
            {
              id: 'service-health',
              title: 'Service Health',
              collapsed: false,
              tabs: [
                { id: 'errors', title: 'Errors' },
                { id: 'errors', title: 'Errors Two' },
              ],
            },
          ],
        })
        .expect(400);

      expect(response.body.message).toContain(
        'Duplicate tab id "errors" in container "service-health"',
      );
    });

    it('round-trips a dashboard with no containers (backward compat)', async () => {
      const sourceId = traceSource._id.toString();
      const response = await authRequest('post', BASE_URL)
        .send({
          name: 'No Containers',
          tiles: [buildTile(sourceId)],
          tags: [],
        })
        .expect(200);

      expect(response.body.data.containers).toBeUndefined();

      const dashboardId = response.body.data.id;
      const getResponse = await authRequest(
        'get',
        `${BASE_URL}/${dashboardId}`,
      ).expect(200);
      expect(getResponse.body.data.containers).toBeUndefined();
    });

    // An explicit empty array is semantically equivalent to no organization
    // layer. The conversion only emits the field when at least one container
    // is present, so the response normalizes [] back to absent. This matches
    // the behavior of optional list fields elsewhere in the API.
    it('normalizes an explicitly empty containers array to absent on read', async () => {
      const sourceId = traceSource._id.toString();
      const response = await authRequest('post', BASE_URL)
        .send({
          name: 'Empty Containers Array',
          tiles: [buildTile(sourceId)],
          tags: [],
          containers: [],
        })
        .expect(200);

      expect(response.body.data.containers).toBeUndefined();

      const getResponse = await authRequest(
        'get',
        `${BASE_URL}/${response.body.data.id}`,
      ).expect(200);
      expect(getResponse.body.data.containers).toBeUndefined();
    });

    it('rejects duplicate container ids on PUT (update path)', async () => {
      // The duplicate-id refine has to fire on the PUT body schema as
      // well as POST. Without this guard a client could downgrade an
      // already-valid dashboard to one with duplicate ids by editing it.
      const sourceId = traceSource._id.toString();
      const createResponse = await authRequest('post', BASE_URL)
        .send({
          name: 'PUT Duplicate Containers',
          tiles: [buildTile(sourceId)],
          tags: [],
          containers: [
            { id: 'a', title: 'A', collapsed: false },
            { id: 'b', title: 'B', collapsed: false },
          ],
        })
        .expect(200);
      const dashboardId = createResponse.body.data.id;

      const response = await authRequest('put', `${BASE_URL}/${dashboardId}`)
        .send({
          name: 'PUT Duplicate Containers',
          tiles: [buildTile(sourceId)],
          tags: [],
          containers: [
            { id: 'dupe', title: 'A', collapsed: false },
            { id: 'dupe', title: 'B', collapsed: false },
          ],
        })
        .expect(400);

      expect(response.body.message).toContain('Container IDs must be unique');
    });

    it('rejects a tile with containerId set when the dashboard omits containers entirely', async () => {
      // Without an explicit `containers: []` and without resolving the
      // `data.containers ?? []` default, the tile-level superRefine
      // would NPE on `containerById.get`. This guards that the
      // containerId still has to resolve even when the field is
      // absent.
      const sourceId = traceSource._id.toString();
      const response = await authRequest('post', BASE_URL)
        .send({
          name: 'Tile with containerId, no containers field',
          tiles: [buildTile(sourceId, { containerId: 'service-health' })],
          tags: [],
        })
        .expect(400);
      expect(response.body.message).toContain(
        'unknown containerId "service-health"',
      );
    });

    it('does not require tabId when a tile is in a tabbed container (tile renders without a tab)', async () => {
      // The contract is: tabId is only required if the tile WANTS to
      // be inside a specific tab. A tile with containerId set to a
      // container that has tabs but no tabId of its own renders in the
      // container shell rather than under any tab. This guards that
      // the schema doesn't accidentally force tabId onto every tile in
      // a tabbed container.
      const sourceId = traceSource._id.toString();
      await authRequest('post', BASE_URL)
        .send({
          name: 'Tabbed container with tile that has no tabId',
          tiles: [buildTile(sourceId, { containerId: 'service-health' })],
          tags: [],
          containers: [
            {
              id: 'service-health',
              title: 'Service Health',
              collapsed: false,
              tabs: [
                { id: 'errors', title: 'Errors' },
                { id: 'latency', title: 'Latency' },
              ],
            },
          ],
        })
        .expect(200);
    });

    it('rejects an empty-string containerId or tabId on a tile', async () => {
      const sourceId = traceSource._id.toString();
      const containerResp = await authRequest('post', BASE_URL)
        .send({
          name: 'Empty containerId',
          tiles: [buildTile(sourceId, { containerId: '' })],
          tags: [],
        })
        .expect(400);
      expect(containerResp.body.message).toContain('tiles.0.containerId');

      const tabResp = await authRequest('post', BASE_URL)
        .send({
          name: 'Empty tabId',
          tiles: [
            buildTile(sourceId, { containerId: 'service-health', tabId: '' }),
          ],
          tags: [],
          containers: [
            {
              id: 'service-health',
              title: 'Service Health',
              collapsed: false,
              tabs: [{ id: 'errors', title: 'Errors' }],
            },
          ],
        })
        .expect(400);
      expect(tabResp.body.message).toContain('tiles.0.tabId');
    });

    // The cap mirrors `DASHBOARD_CONTAINER_ID_MAX` in
    // `packages/common-utils/src/types.ts`. The 256-char id sits at the
    // boundary; 257 chars must reject.
    it('accepts a 256-char containerId, rejects 257', async () => {
      const sourceId = traceSource._id.toString();
      const idAtMax = 'a'.repeat(256);
      const idTooLong = 'a'.repeat(257);

      await authRequest('post', BASE_URL)
        .send({
          name: 'Containers id at boundary',
          tiles: [buildTile(sourceId, { containerId: idAtMax })],
          tags: [],
          containers: [{ id: idAtMax, title: 'At boundary', collapsed: false }],
        })
        .expect(200);

      const overResp = await authRequest('post', BASE_URL)
        .send({
          name: 'Containers id over boundary',
          tiles: [buildTile(sourceId, { containerId: idTooLong })],
          tags: [],
          containers: [
            { id: idTooLong, title: 'Over boundary', collapsed: false },
          ],
        })
        .expect(400);
      expect(overResp.body.message).toContain('tiles.0.containerId');
    });

    it('accepts a 256-char tabId, rejects 257', async () => {
      const sourceId = traceSource._id.toString();
      const tabAtMax = 'b'.repeat(256);
      const tabTooLong = 'b'.repeat(257);

      await authRequest('post', BASE_URL)
        .send({
          name: 'Tab id at boundary',
          tiles: [
            buildTile(sourceId, {
              containerId: 'service-health',
              tabId: tabAtMax,
            }),
          ],
          tags: [],
          containers: [
            {
              id: 'service-health',
              title: 'Service Health',
              collapsed: false,
              tabs: [{ id: tabAtMax, title: 'At boundary' }],
            },
          ],
        })
        .expect(200);

      const overResp = await authRequest('post', BASE_URL)
        .send({
          name: 'Tab id over boundary',
          tiles: [
            buildTile(sourceId, {
              containerId: 'service-health',
              tabId: tabTooLong,
            }),
          ],
          tags: [],
          containers: [
            {
              id: 'service-health',
              title: 'Service Health',
              collapsed: false,
              tabs: [{ id: tabTooLong, title: 'Over boundary' }],
            },
          ],
        })
        .expect(400);
      expect(overResp.body.message).toContain('tiles.0.tabId');
    });

    // Cap of 500 mirrors `DASHBOARD_MAX_TILES`. Tested at boundary so the
    // limit doesn't accidentally drift.
    it('rejects a payload of 501 tiles', async () => {
      const sourceId = traceSource._id.toString();
      const tooManyTiles = Array.from({ length: 501 }, (_, i) =>
        buildTile(sourceId, { name: `Tile ${i}` }),
      );

      const resp = await authRequest('post', BASE_URL)
        .send({
          name: 'Too many tiles',
          tiles: tooManyTiles,
          tags: [],
        })
        .expect(400);
      // Zod surfaces the path; we just want a 400 with a clear pointer.
      expect(resp.body.message).toContain('tiles');
    });

    // Older Mongo docs predate the containers feature and `tiles: Mixed`
    // doesn't enforce `min(1)`. A doc with `containerId: ""` left over
    // from earlier code paths must round-trip on read as if absent so
    // a subsequent PUT can validate. Insert directly into Mongo so we
    // bypass the create-path schema (which now rejects empty strings).
    it('treats an empty-string containerId on a legacy doc as absent on read', async () => {
      const sourceId = traceSource._id.toString();
      const tile = buildTile(sourceId, { name: 'Legacy empty containerId' });
      const created = await authRequest('post', BASE_URL)
        .send({
          name: 'Legacy doc round-trip',
          tiles: [tile],
          tags: [],
        })
        .expect(200);
      const dashboardId = created.body.data.id;

      // Mutate Mongo directly to simulate the legacy state.
      await Dashboard.updateOne(
        { _id: dashboardId },
        { $set: { 'tiles.0.containerId': '', 'tiles.0.tabId': '' } },
      );

      const getResp = await authRequest(
        'get',
        `${BASE_URL}/${dashboardId}`,
      ).expect(200);
      const [returnedTile] = getResp.body.data.tiles;
      expect(returnedTile.containerId).toBeUndefined();
      expect(returnedTile.tabId).toBeUndefined();
    });

    // P0/P1-1 regression: PUT must preserve the existing containers
    // array when the body omits the field. Tile-level container ref
    // resolution runs against the effective container set (body
    // containers OR existing doc containers), not against the body's
    // containers in isolation. Without this guard, a PUT that updates
    // only `tiles` and references a real preserved container is
    // rejected with "Tile references unknown containerId" because the
    // body's containers fall back to an empty array.
    it('preserves existing containers on PUT when the body omits the field', async () => {
      const sourceId = traceSource._id.toString();
      const containers = [
        {
          id: 'service-health',
          title: 'Service Health',
          collapsed: false,
          tabs: [{ id: 'errors', title: 'Errors' }],
        },
      ];

      const created = await authRequest('post', BASE_URL)
        .send({
          name: 'Preserve containers on PUT',
          tiles: [
            buildTile(sourceId, {
              name: 'In container',
              containerId: 'service-health',
              tabId: 'errors',
            }),
          ],
          tags: [],
          containers,
        })
        .expect(200);
      const dashboardId = created.body.data.id;
      const [createdTile] = created.body.data.tiles;

      // PUT keeps the same tile (still pointing at service-health/errors)
      // but does not include `containers` in the body. The handler must
      // fall back to the existing containers and resolve the tile ref
      // against them, so the request succeeds.
      const putResp = await authRequest('put', `${BASE_URL}/${dashboardId}`)
        .send({
          name: 'Preserve containers on PUT',
          tiles: [createdTile],
          tags: [],
        })
        .expect(200);

      // Containers were preserved on the doc and round-trip on the
      // response, even though the request body didn't carry them.
      expect(putResp.body.data.containers).toEqual(containers);
      const [putTile] = putResp.body.data.tiles;
      expect(putTile.containerId).toBe('service-health');
      expect(putTile.tabId).toBe('errors');
    });

    // P0/P1-1 negative case: even when the body omits `containers`, a
    // tile that references a containerId not present in the existing
    // dashboard's containers must still be rejected. The fallback only
    // permits real containers, not arbitrary ones.
    it('rejects a PUT that references an unknown containerId when body omits containers', async () => {
      const sourceId = traceSource._id.toString();
      const created = await authRequest('post', BASE_URL)
        .send({
          name: 'PUT unknown containerId',
          tiles: [buildTile(sourceId, { name: 'Real tile' })],
          tags: [],
          containers: [{ id: 'real', title: 'Real', collapsed: false }],
        })
        .expect(200);
      const dashboardId = created.body.data.id;

      const resp = await authRequest('put', `${BASE_URL}/${dashboardId}`)
        .send({
          name: 'PUT unknown containerId',
          tiles: [
            buildTile(sourceId, {
              name: 'Bad ref',
              containerId: 'does-not-exist',
            }),
          ],
          tags: [],
        })
        .expect(400);
      expect(resp.body.message).toContain(
        'unknown containerId "does-not-exist"',
      );
    });

    // Critical P2-4 regression: a Mongo doc with a tile.containerId
    // that no longer matches any container in the doc (a container
    // got removed without re-homing the tile, or the doc predates
    // the containers feature) must round-trip as if the ref were
    // absent. Without this self-heal, the GET response would carry
    // a containerId that the next PUT body schema rejects, breaking
    // the round-trip for legacy data.
    it('drops orphan tile.containerId on read when no container matches', async () => {
      const sourceId = traceSource._id.toString();
      const created = await authRequest('post', BASE_URL)
        .send({
          name: 'Orphan containerId heal',
          tiles: [buildTile(sourceId, { name: 'Real tile' })],
          tags: [],
          containers: [
            {
              id: 'real',
              title: 'Real',
              collapsed: false,
              tabs: [{ id: 'errors', title: 'Errors' }],
            },
          ],
        })
        .expect(200);
      const dashboardId = created.body.data.id;

      // Mutate Mongo directly to plant an orphan ref. `tiles` is
      // `Mixed`, so the model layer doesn't enforce ref consistency;
      // historical writes (or future bugs) can leave the doc in this
      // shape.
      await Dashboard.updateOne(
        { _id: dashboardId },
        {
          $set: {
            'tiles.0.containerId': 'ghost-container',
            'tiles.0.tabId': 'ghost-tab',
          },
        },
      );

      const getResp = await authRequest(
        'get',
        `${BASE_URL}/${dashboardId}`,
      ).expect(200);
      const [returnedTile] = getResp.body.data.tiles;
      expect(returnedTile.containerId).toBeUndefined();
      expect(returnedTile.tabId).toBeUndefined();
    });

    // Critical P2-4 regression (tab-only orphan): a tile that points
    // at a real container but a tab that no longer exists in that
    // container must drop only `tabId`, keeping `containerId`.
    // Without this, a stale tabId would fail the next PUT body schema
    // even though the container itself is fine.
    it('drops orphan tile.tabId on read when no tab matches', async () => {
      const sourceId = traceSource._id.toString();
      const created = await authRequest('post', BASE_URL)
        .send({
          name: 'Orphan tabId heal',
          tiles: [
            buildTile(sourceId, {
              name: 'Real tile',
              containerId: 'real',
              tabId: 'errors',
            }),
          ],
          tags: [],
          containers: [
            {
              id: 'real',
              title: 'Real',
              collapsed: false,
              tabs: [{ id: 'errors', title: 'Errors' }],
            },
          ],
        })
        .expect(200);
      const dashboardId = created.body.data.id;

      // Replace the tile's tabId with one that doesn't exist in the
      // container.
      await Dashboard.updateOne(
        { _id: dashboardId },
        { $set: { 'tiles.0.tabId': 'ghost-tab' } },
      );

      const getResp = await authRequest(
        'get',
        `${BASE_URL}/${dashboardId}`,
      ).expect(200);
      const [returnedTile] = getResp.body.data.tiles;
      expect(returnedTile.containerId).toBe('real');
      expect(returnedTile.tabId).toBeUndefined();
    });
  });

  describe('DELETE /:id', () => {
    it('should delete a dashboard', async () => {
      const dashboard = await createTestDashboard();

      await authRequest('delete', `${BASE_URL}/${dashboard._id}`).expect(200);

      // Verify dashboard was deleted
      const deletedDashboard = await Dashboard.findById(dashboard._id);
      expect(deletedDashboard).toBeNull();
    });
  });

  describe('Authentication', () => {
    it('should require authentication for all endpoints', async () => {
      // Create an unauthenticated agent
      const unauthenticatedAgent = request(server.getHttpServer());

      const testId = '507f1f77bcf86cd799439011';
      const routes = [
        { method: 'get', path: BASE_URL },
        { method: 'get', path: `${BASE_URL}/${testId}` },
        { method: 'post', path: BASE_URL },
        { method: 'put', path: `${BASE_URL}/${testId}` },
        { method: 'delete', path: `${BASE_URL}/${testId}` },
      ];

      for (const { method, path } of routes) {
        await unauthenticatedAgent[method](path).expect(401);
      }
    });
  });
});
