import { MetricsDataType, SourceKind } from '@hyperdx/common-utils/dist/types';
import { omit } from 'lodash';
import { ObjectId } from 'mongodb';
import request from 'supertest';

import {
  ExternalDashboardTile,
  ExternalDashboardTileWithId,
  MarkdownChartSeries,
  NumberChartSeries,
  TableChartSeries,
  TimeChartSeries,
} from '@/utils/zod';

import * as config from '../../../config';
import {
  DEFAULT_DATABASE,
  DEFAULT_TRACES_TABLE,
  getLoggedInAgent,
  getServer,
  makeExternalChart,
  makeExternalTile,
} from '../../../fixtures';
import Connection from '../../../models/connection';
import Dashboard from '../../../models/dashboard';
import { Source } from '../../../models/source';

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
          },
        ],
      };

      const response = await authRequest('post', BASE_URL)
        .send(dashboardPayload)
        .expect(200);

      expect(response.body.data.filters).toHaveLength(2);
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
      expect(response.body.data.filters[1].name).toBe('Service Filter');
      expect(response.body.data.filters[1].expression).toBe('service_name');

      const getResponse = await authRequest(
        'get',
        `${BASE_URL}/${response.body.data.id}`,
      ).expect(200);
      expect(getResponse.body.data.filters).toHaveLength(2);
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
            },
            {
              id: filterId2,
              type: 'QUERY_EXPRESSION' as const,
              name: 'Updated Filter 2',
              expression: 'service_name',
              sourceId: traceSource._id.toString(),
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
      expect(response.body.data.filters[1]).toMatchObject({
        id: expect.any(String),
        type: 'QUERY_EXPRESSION',
        name: 'Updated Filter 2',
        expression: 'service_name',
        sourceId: traceSource._id.toString(),
      });

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
          },
        ],
      };

      const response = await authRequest('post', BASE_URL)
        .send(dashboardPayload)
        .expect(200);

      expect(response.body.data.filters).toHaveLength(2);
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
      expect(response.body.data.filters[1].name).toBe('Service Filter');
      expect(response.body.data.filters[1].expression).toBe('service_name');

      const getResponse = await authRequest(
        'get',
        `${BASE_URL}/${response.body.data.id}`,
      ).expect(200);
      expect(getResponse.body.data.filters).toHaveLength(2);
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
            },
            {
              id: filterId2,
              type: 'QUERY_EXPRESSION' as const,
              name: 'Updated Filter 2',
              expression: 'service_name',
              sourceId: traceSource._id.toString(),
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
      expect(response.body.data.filters[1]).toMatchObject({
        id: expect.any(String),
        type: 'QUERY_EXPRESSION',
        name: 'Updated Filter 2',
        expression: 'service_name',
        sourceId: traceSource._id.toString(),
      });

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
