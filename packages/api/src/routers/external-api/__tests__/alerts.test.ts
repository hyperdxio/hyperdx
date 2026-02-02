import _ from 'lodash';
import { ObjectId } from 'mongodb';
import request from 'supertest';

import { getLoggedInAgent, getServer } from '../../../fixtures';
import { AlertSource, AlertThresholdType } from '../../../models/alert';
import Alert from '../../../models/alert';
import Dashboard from '../../../models/dashboard';

// Constants
const ALERTS_BASE_URL = '/api/v2/alerts';

describe('External API Alerts', () => {
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

  // Helper to make authenticated requests
  const authRequest = (method, url) => {
    return agent[method](url).set('Authorization', `Bearer ${user?.accessKey}`);
  };

  // Helper to create a dashboard for testing
  const createTestDashboard = async (
    options: { numTiles?: number; name?: string } = {},
  ) => {
    const { numTiles = 1, name = 'Test Dashboard' } = options;

    const tiles = Array.from({ length: numTiles }, (_, i) => ({
      id: new ObjectId().toString(),
      name: `Chart ${i + 1}`,
      x: i * 6,
      y: Math.floor(i / 2) * 3,
      w: 6,
      h: 3,
      seriesReturnType: 'column',
    }));

    return new Dashboard({
      name,
      tiles,
      team: team._id,
    }).save();
  };

  // Helper to create a test alert via API
  const createTestAlert = async (overrides = {}) => {
    const dashboard = await createTestDashboard();

    const alertInput = {
      dashboardId: dashboard._id.toString(),
      tileId: dashboard.tiles[0].id,
      threshold: 100,
      interval: '1h',
      source: AlertSource.TILE,
      thresholdType: AlertThresholdType.ABOVE,
      channel: {
        type: 'webhook',
        webhookId: new ObjectId().toString(),
      },
      name: 'Test Alert',
      message: 'Test Alert Message',
      ...overrides,
    };

    const response = await authRequest('post', ALERTS_BASE_URL)
      .send(alertInput)
      .expect(200);

    return {
      alert: response.body.data,
      dashboard,
      alertInput,
    };
  };

  // Helper to create a test alert directly in the database
  const createTestAlertDirectly = async (overrides = {}) => {
    return Alert.create({
      team: team._id,
      dashboardId: new ObjectId().toString(),
      tileId: new ObjectId().toString(),
      threshold: 100,
      interval: '1h',
      source: AlertSource.TILE,
      thresholdType: AlertThresholdType.ABOVE,
      channel: {
        type: 'webhook',
        webhookId: new ObjectId().toString(),
      },
      name: 'Direct DB Alert',
      message: 'Created directly in DB',
      ...overrides,
    });
  };

  describe('Response Format', () => {
    it('should return responses in the expected format', async () => {
      // Create a test alert with known values
      const testDashboard = await createTestDashboard();
      const testAlert = {
        dashboardId: testDashboard._id.toString(),
        tileId: testDashboard.tiles[0].id,
        threshold: 123,
        interval: '15m',
        source: AlertSource.TILE,
        thresholdType: AlertThresholdType.ABOVE,
        channel: {
          type: 'webhook',
          webhookId: new ObjectId().toString(),
        },
        name: 'Format Test Alert',
        message: 'This is a test alert for format verification',
      };

      // Create the alert
      const createResponse = await authRequest('post', ALERTS_BASE_URL)
        .send(testAlert)
        .expect(200);

      // Verify full response structure
      expect(createResponse.headers['content-type']).toMatch(
        /application\/json/,
      );
      expect(createResponse.body).toEqual({
        data: {
          id: expect.any(String),
          name: 'Format Test Alert',
          message: 'This is a test alert for format verification',
          threshold: 123,
          interval: '15m',
          source: AlertSource.TILE,
          thresholdType: AlertThresholdType.ABOVE,
          channel: {
            type: 'webhook',
            webhookId: expect.any(String),
          },
          teamId: expect.any(String),
          tileId: expect.any(String),
          dashboardId: expect.any(String),
          state: expect.any(String),
          createdAt: expect.any(String),
          updatedAt: expect.any(String),
        },
      });

      // Get the alert to verify consistent format
      const alertId = createResponse.body.data.id;
      const getResponse = await authRequest(
        'get',
        `${ALERTS_BASE_URL}/${alertId}`,
      ).expect(200);

      // Verify get response has same structure
      expect(getResponse.headers['content-type']).toMatch(/application\/json/);
      expect(getResponse.body).toEqual({
        data: createResponse.body.data,
      });

      // List endpoint format
      const listResponse = await authRequest('get', ALERTS_BASE_URL).expect(
        200,
      );

      expect(listResponse.headers['content-type']).toMatch(/application\/json/);
      expect(listResponse.body).toHaveProperty('data');
      expect(Array.isArray(listResponse.body.data)).toBe(true);

      // Delete response format
      const deleteResponse = await authRequest(
        'delete',
        `${ALERTS_BASE_URL}/${alertId}`,
      ).expect(200);

      expect(deleteResponse.body).toEqual({});
    });
  });

  describe('Creating alerts', () => {
    it('should create an alert', async () => {
      // Create a test dashboard
      const dashboard = await createTestDashboard();

      // Create alert data
      const webhookId = new ObjectId().toString();
      const alertInput = {
        dashboardId: dashboard._id.toString(),
        tileId: dashboard.tiles[0].id,
        threshold: 100,
        interval: '1h',
        source: AlertSource.TILE,
        thresholdType: AlertThresholdType.ABOVE,
        channel: {
          type: 'webhook',
          webhookId: webhookId,
        },
        name: 'Test Alert',
        message: 'Test Alert Message',
      };

      // Create the alert and verify response
      const createResponse = await authRequest('post', ALERTS_BASE_URL)
        .send(alertInput)
        .expect(200);

      const createdAlert = createResponse.body.data;
      expect(createdAlert).toBeTruthy();
      expect(createdAlert.threshold).toEqual(100);
      expect(createdAlert.interval).toEqual('1h');
      expect(createdAlert.name).toEqual('Test Alert');
      expect(createdAlert.id).toBeTruthy();
    });

    it('should handle validation errors when creating alerts', async () => {
      // Spy on console.error to suppress error output in tests
      const consoleErrorSpy = jest
        .spyOn(console, 'error')
        .mockImplementation(() => {});

      // Missing required fields
      const invalidInput = {
        name: 'Invalid Alert',
        message: 'This should fail validation',
      };

      // API returns 400 for validation errors
      const response = await authRequest('post', ALERTS_BASE_URL)
        .send(invalidInput)
        .expect(400);

      expect(response.body).toHaveProperty('message');

      // Restore console.error
      consoleErrorSpy.mockRestore();
    });

    it('should create multiple alerts for different tiles', async () => {
      // Create a dashboard with multiple tiles
      const dashboard = await createTestDashboard({ numTiles: 3 });

      // Store created alert IDs for verification
      const createdAlertIds: string[] = [];

      // Create alerts for each tile
      const alertPromises = dashboard.tiles.map((tile, index) => {
        const alertInput = {
          dashboardId: dashboard._id.toString(),
          tileId: tile.id,
          threshold: 100 * (index + 1),
          interval: '1h',
          source: AlertSource.TILE,
          thresholdType: AlertThresholdType.ABOVE,
          channel: {
            type: 'webhook',
            webhookId: new ObjectId().toString(),
          },
          name: `Alert for ${tile.id}`,
          message: `This is an alert for ${tile.id}`,
        };

        return authRequest('post', ALERTS_BASE_URL)
          .send(alertInput)
          .expect(200)
          .then(res => {
            createdAlertIds.push(res.body.data.id);
            return res;
          });
      });

      // Wait for all alerts to be created
      const results = await Promise.all(alertPromises);
      const createdAlerts = results.map(res => res.body.data);
      expect(createdAlerts.length).toBe(3);

      // Verify all alerts were created by checking the alerts list
      const listResponse = await authRequest('get', ALERTS_BASE_URL).expect(
        200,
      );

      // Verify each created alert exists in the response
      for (const alertId of createdAlertIds) {
        const found = listResponse.body.data.some(
          alert => alert.id === alertId,
        );
        expect(found).toBe(true);
      }

      // Verify we have alerts for each tile
      const tileIds = dashboard.tiles.map(tile => tile.id);
      for (const tileId of tileIds) {
        const alertForTile = listResponse.body.data.find(
          alert => alert.tileId === tileId,
        );
        expect(alertForTile).toBeTruthy();
      }
    });
  });

  describe('Retrieving alerts', () => {
    it('should get an alert by ID', async () => {
      // Create a test alert directly in the database
      const alert = await createTestAlertDirectly();

      // Get the alert via API
      const getResponse = await authRequest(
        'get',
        `${ALERTS_BASE_URL}/${alert._id}`,
      ).expect(200);

      // Verify response
      expect(getResponse.body.data.id).toEqual(alert._id.toString());
      expect(getResponse.body.data.name).toEqual('Direct DB Alert');
    });

    it('should return 404 for non-existent alert', async () => {
      const nonExistentId = new ObjectId().toString();
      await authRequest('get', `${ALERTS_BASE_URL}/${nonExistentId}`).expect(
        404,
      );
    });

    it('should list all alerts', async () => {
      // Create multiple alerts with different properties
      await createTestAlert({ name: 'First Alert', threshold: 100 });
      await createTestAlert({ name: 'Second Alert', threshold: 200 });
      await createTestAlert({ name: 'Third Alert', threshold: 300 });

      // Get all alerts via API
      const listResponse = await authRequest('get', ALERTS_BASE_URL).expect(
        200,
      );

      // Verify response format and content
      expect(listResponse.body.data).toBeTruthy();
      expect(Array.isArray(listResponse.body.data)).toBe(true);
      expect(listResponse.body.data.length).toBeGreaterThanOrEqual(3);

      // Verify alerts exist in the response
      const alertNames = listResponse.body.data.map(alert => alert.name);
      expect(alertNames).toContain('First Alert');
      expect(alertNames).toContain('Second Alert');
      expect(alertNames).toContain('Third Alert');

      // Verify alert properties
      const firstAlert = listResponse.body.data.find(
        a => a.name === 'First Alert',
      );
      expect(firstAlert.threshold).toBe(100);

      const secondAlert = listResponse.body.data.find(
        a => a.name === 'Second Alert',
      );
      expect(secondAlert.threshold).toBe(200);
    });
  });

  describe('Updating alerts', () => {
    it('should update an alert', async () => {
      // Create a test alert
      const { alert } = await createTestAlert({
        name: 'Update Test Alert',
        threshold: 100,
        interval: '15m',
        message: 'Original message',
      });

      // Get the original alert to include all required fields
      const originalAlert = await authRequest(
        'get',
        `${ALERTS_BASE_URL}/${alert.id}`,
      ).expect(200);

      // Build update payload with required fields
      const updatePayload = {
        threshold: 500,
        interval: '1h',
        thresholdType: AlertThresholdType.ABOVE,
        source: AlertSource.TILE,
        dashboardId: originalAlert.body.data.dashboardId,
        tileId: originalAlert.body.data.tileId,
        channel: originalAlert.body.data.channel,

        // Fields we want to update
        name: 'Updated Alert Name',
        message: 'Updated message',
      };

      // Update the alert
      await authRequest('put', `${ALERTS_BASE_URL}/${alert.id}`)
        .send(updatePayload)
        .expect(200);

      // Verify the update was applied by getting the alert again
      const getResponse = await authRequest(
        'get',
        `${ALERTS_BASE_URL}/${alert.id}`,
      ).expect(200);

      const retrievedAlert = getResponse.body.data;

      // Verify updates were applied
      expect(retrievedAlert.name).toBe('Updated Alert Name');
      expect(retrievedAlert.threshold).toBe(500);
      expect(retrievedAlert.interval).toBe('1h');
      expect(retrievedAlert.message).toBe('Updated message');
    });
  });

  describe('Deleting alerts', () => {
    it('should delete an alert', async () => {
      // Create a test alert
      const { alert } = await createTestAlert({ name: 'Delete Test Alert' });

      // Delete the alert
      await authRequest('delete', `${ALERTS_BASE_URL}/${alert.id}`).expect(200);

      // Verify alert is deleted by trying to get it
      await authRequest('get', `${ALERTS_BASE_URL}/${alert.id}`).expect(404);
      // Also verify it's not in the alerts list
      const listResponse = await authRequest('get', ALERTS_BASE_URL).expect(
        200,
      );

      const deletedAlert = listResponse.body.data.find(a => a.id === alert.id);
      expect(deletedAlert).toBeUndefined();
    });
  });

  describe('Authentication', () => {
    it('should require authentication', async () => {
      // Create an unauthenticated agent
      const unauthenticatedAgent = request(server.getHttpServer());

      const testId = new ObjectId().toString();
      await unauthenticatedAgent
        .get(`${ALERTS_BASE_URL}/${testId}`)
        .expect(401);
    });
  });
});
