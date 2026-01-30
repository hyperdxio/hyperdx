import { MetricsDataType, SourceKind } from '@hyperdx/common-utils/dist/types';
import { omit } from 'lodash';
import { ObjectId } from 'mongodb';
import request from 'supertest';

import {
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
} from '../../../fixtures';
import Connection from '../../../models/connection';
import Dashboard from '../../../models/dashboard';
import { Source } from '../../../models/source';

// Constants
const BASE_URL = '/api/v2/dashboards';
const TEST_TAGS = ['external-api', 'test'];

// Test data factory functions
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

describe('External API v2 Dashboards', () => {
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
              asRatio: false,
              series: [
                {
                  type: 'time',
                  sourceId: traceSource._id.toString(),
                  aggFn: 'count',
                  where: '',
                  whereLanguage: 'lucene',
                  groupBy: [],
                  displayType: 'line',
                  field: '',
                },
              ],
            },
            {
              id: expect.any(String),
              name: 'Number Chart',
              x: 0,
              y: 3,
              w: 3,
              h: 3,
              asRatio: false,
              series: [
                {
                  type: 'number',
                  sourceId: traceSource._id.toString(),
                  aggFn: 'count',
                  where: '',
                  whereLanguage: 'lucene',
                  field: '',
                },
              ],
            },
          ],
          tags: ['format-test'],
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

    it('can round-trip all supported chart types and all supported fields on each chart type', async () => {
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

      // Assert response matches input (ignoring generated IDs)
      expect(omit(response.body.data.tiles[0], ['id'])).toEqual(lineChart);
      expect(omit(response.body.data.tiles[1], ['id'])).toEqual(barChart);
      expect(omit(response.body.data.tiles[2], ['id'])).toEqual(tableChart);
      expect(omit(response.body.data.tiles[3], ['id'])).toEqual(numberChart);
      expect(omit(response.body.data.tiles[4], ['id'])).toEqual(markdownChart);
    });

    it('should return 404 when source IDs do not exist', async () => {
      const nonExistentSourceId = new ObjectId().toString();
      const mockDashboard = createMockDashboard(nonExistentSourceId);

      const response = await authRequest('post', BASE_URL)
        .send(mockDashboard)
        .expect(404);

      expect(response.body).toEqual({
        message: `Could not find the following source IDs: ${nonExistentSourceId}`,
      });
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

      // Verify dashboard was updated in database
      const updatedDashboardInDb = await Dashboard.findById(
        dashboard._id,
      ).lean();
      expect(updatedDashboardInDb?.name).toBe('Updated Dashboard Name');
      expect(updatedDashboardInDb?.tiles).toHaveLength(2);
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

    it('can round-trip all supported chart types and all supported fields on each chart type', async () => {
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

      // Assert response matches input (ignoring generated IDs)
      expect(response.body.data.tiles[0]).toEqual(lineChart);
      expect(response.body.data.tiles[1]).toEqual(barChart);
      expect(response.body.data.tiles[2]).toEqual(tableChart);
      expect(response.body.data.tiles[3]).toEqual(numberChart);
      expect(response.body.data.tiles[4]).toEqual(markdownChart);
    });

    it('should return 404 when source IDs do not exist', async () => {
      const dashboard = await createTestDashboard();
      const nonExistentSourceId = new ObjectId().toString();
      const updatedDashboard = createMockDashboardWithIds(nonExistentSourceId, {
        name: 'Updated Dashboard Name',
      });

      const response = await authRequest('put', `${BASE_URL}/${dashboard._id}`)
        .send(updatedDashboard)
        .expect(404);

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
