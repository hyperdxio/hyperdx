import { ObjectId } from 'mongodb';
import request from 'supertest';

import {
  getLoggedInAgent,
  getServer,
  makeExternalChart,
} from '../../../fixtures';
import Dashboard from '../../../models/dashboard';

// Constants
const BASE_URL = '/api/v2/dashboards';
const TEST_TAGS = ['external-api', 'test'];

// Test data factory functions
const createMockDashboard = (overrides = {}) => ({
  name: 'Test External Dashboard',
  tiles: [makeExternalChart(), makeExternalChart()],
  tags: TEST_TAGS,
  ...overrides,
});

const createMockDashboardWithIds = (overrides = {}) => ({
  name: 'Test External Dashboard with IDs',
  tiles: [
    { ...makeExternalChart(), id: new ObjectId().toString() },
    { ...makeExternalChart(), id: new ObjectId().toString() },
  ],
  tags: TEST_TAGS,
  ...overrides,
});

// Test chart factory functions
const createTimeSeriesChart = () => ({
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
      table: 'logs',
      aggFn: 'count',
      where: '',
      groupBy: [],
    },
  ],
});

const createTableChart = () => ({
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
      table: 'logs',
      aggFn: 'count',
      where: '',
      groupBy: [],
      sortOrder: 'desc',
    },
  ],
});

const createNumberChart = () => ({
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
      table: 'logs',
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
  let agent, team, user;

  beforeAll(async () => {
    await server.start();
  });

  beforeEach(async () => {
    // Setup authenticated agent for each test
    const result = await getLoggedInAgent(server);
    agent = result.agent;
    team = result.team;
    user = result.user;
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
        tiles: [createTimeSeriesChart(), createNumberChart()],
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
              seriesReturnType: 'column',
              series: [
                {
                  type: 'time',
                  table: 'logs',
                  aggFn: 'count',
                  where: '',
                  groupBy: [],
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
              seriesReturnType: 'column',
              series: [
                {
                  type: 'number',
                  table: 'logs',
                  aggFn: 'count',
                  where: '',
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
      const mockDashboard = createMockDashboard();

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
          createTimeSeriesChart(),
          createTableChart(),
          createNumberChart(),
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
  });

  describe('PUT /:id', () => {
    it('should update an existing dashboard', async () => {
      const dashboard = await createTestDashboard();
      const updatedDashboard = createMockDashboardWithIds({
        name: 'Updated Dashboard Name',
      });

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
      const mockDashboard = createMockDashboardWithIds();

      await authRequest('put', `${BASE_URL}/${nonExistentId}`)
        .send(mockDashboard)
        .expect(404);
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
