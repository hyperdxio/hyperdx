import { AlertErrorType } from '@hyperdx/common-utils/dist/types';
import _ from 'lodash';
import { ObjectId } from 'mongodb';
import request from 'supertest';

import {
  getLoggedInAgent,
  getServer,
  RAW_SQL_ALERT_TEMPLATE,
  RAW_SQL_NUMBER_ALERT_TEMPLATE,
} from '../../../fixtures';
import { AlertSource, AlertThresholdType } from '../../../models/alert';
import Alert from '../../../models/alert';
import Dashboard from '../../../models/dashboard';
import { SavedSearch } from '../../../models/savedSearch';
import Webhook, { WebhookService } from '../../../models/webhook';

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

  // Helper to create a webhook for testing
  const createTestWebhook = async (options: { teamId?: any } = {}) => {
    return await Webhook.findOneAndUpdate(
      {
        name: 'Test Webhook',
        service: WebhookService.Slack,
        team: options.teamId ?? team._id,
      },
      {
        name: 'Test Webhook',
        service: WebhookService.Slack,
        url: 'https://hooks.slack.com/test',
        team: options.teamId ?? team._id,
      },
      { upsert: true, new: true },
    );
  };

  // Helper to create a dashboard for testing
  const createTestDashboard = async (
    options: { numTiles?: number; name?: string; teamId?: any } = {},
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
      team: options.teamId ?? team._id,
    }).save();
  };

  // Helper to create a dashboard with a raw SQL tile for testing
  // Uses Number display type by default (not alertable) for rejection tests
  const createTestDashboardWithRawSqlTile = async (
    options: {
      teamId?: any;
      displayType?: string;
      sqlTemplate?: string;
    } = {},
  ) => {
    const tileId = new ObjectId().toString();
    const tiles = [
      {
        id: tileId,
        name: 'Raw SQL Chart',
        x: 0,
        y: 0,
        w: 6,
        h: 3,
        config: {
          configType: 'sql',
          displayType: options.displayType ?? 'number',
          sqlTemplate: options.sqlTemplate ?? 'SELECT 1',
          connection: 'test-connection',
        },
      },
    ];

    const dashboard = await new Dashboard({
      name: 'Raw SQL Dashboard',
      tiles,
      team: options.teamId ?? team._id,
    }).save();

    return { dashboard, tileId };
  };

  // Helper to create a saved search for testing
  const createTestSavedSearch = async (options: { teamId?: any } = {}) => {
    return new SavedSearch({
      name: 'Test Saved Search',
      where: 'error',
      whereLanguage: 'lucene',
      source: new ObjectId(),
      team: options.teamId ?? team._id,
    }).save();
  };

  // Helper to create a test alert via API
  const createTestAlert = async (overrides = {}) => {
    const dashboard = await createTestDashboard();
    const webhook = await createTestWebhook();

    const alertInput = {
      dashboardId: dashboard._id.toString(),
      tileId: dashboard.tiles[0].id,
      threshold: 100,
      interval: '1h',
      source: AlertSource.TILE,
      thresholdType: AlertThresholdType.ABOVE,
      channel: {
        type: 'webhook',
        webhookId: webhook._id.toString(),
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
      webhook,
      alertInput,
    };
  };

  // Helper to create a test alert directly in the database (bypasses validation)
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
      // Create a test dashboard and webhook with known values
      const testDashboard = await createTestDashboard();
      const testWebhook = await createTestWebhook();
      const testAlert = {
        dashboardId: testDashboard._id.toString(),
        tileId: testDashboard.tiles[0].id,
        threshold: 123,
        interval: '15m',
        source: AlertSource.TILE,
        thresholdType: AlertThresholdType.ABOVE,
        channel: {
          type: 'webhook',
          webhookId: testWebhook._id.toString(),
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
      // Create a test dashboard and webhook
      const dashboard = await createTestDashboard();
      const webhook = await createTestWebhook();

      const alertInput = {
        dashboardId: dashboard._id.toString(),
        tileId: dashboard.tiles[0].id,
        threshold: 100,
        interval: '1h',
        source: AlertSource.TILE,
        thresholdType: AlertThresholdType.ABOVE,
        channel: {
          type: 'webhook',
          webhookId: webhook._id.toString(),
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

    it('should reject scheduleOffsetMinutes when scheduleStartAt is provided', async () => {
      const dashboard = await createTestDashboard();

      const response = await authRequest('post', ALERTS_BASE_URL)
        .send({
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
          scheduleOffsetMinutes: 2,
          scheduleStartAt: new Date().toISOString(),
        })
        .expect(400);

      expect(response.body).toHaveProperty('message');
    });

    it('should reject scheduleStartAt values more than 1 year in the future', async () => {
      const dashboard = await createTestDashboard();

      const response = await authRequest('post', ALERTS_BASE_URL)
        .send({
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
          scheduleStartAt: new Date(
            Date.now() + 366 * 24 * 60 * 60 * 1000,
          ).toISOString(),
        })
        .expect(400);

      expect(response.body).toHaveProperty('message');
    });

    it('should create multiple alerts for different tiles', async () => {
      // Create a dashboard with multiple tiles
      const dashboard = await createTestDashboard({ numTiles: 3 });
      const webhook = await createTestWebhook();

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
            webhookId: webhook._id.toString(),
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

    it('should reject scheduleOffsetMinutes when scheduleStartAt is provided', async () => {
      const { alert } = await createTestAlert({
        interval: '1h',
      });

      const originalAlert = await authRequest(
        'get',
        `${ALERTS_BASE_URL}/${alert.id}`,
      ).expect(200);

      await authRequest('put', `${ALERTS_BASE_URL}/${alert.id}`)
        .send({
          threshold: originalAlert.body.data.threshold,
          interval: originalAlert.body.data.interval,
          thresholdType: originalAlert.body.data.thresholdType,
          source: originalAlert.body.data.source,
          dashboardId: originalAlert.body.data.dashboardId,
          tileId: originalAlert.body.data.tileId,
          channel: originalAlert.body.data.channel,
          scheduleOffsetMinutes: 2,
          scheduleStartAt: new Date().toISOString(),
        })
        .expect(400);
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

  describe('Input validation', () => {
    describe('webhook validation', () => {
      it('should reject a non-existent webhook', async () => {
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
            webhookId: new ObjectId().toString(), // does not exist
          },
        };

        await authRequest('post', ALERTS_BASE_URL).send(alertInput).expect(400);
      });

      it('should reject a webhook belonging to another team', async () => {
        const dashboard = await createTestDashboard();
        const otherTeamWebhook = await createTestWebhook({
          teamId: new ObjectId(),
        });

        const alertInput = {
          dashboardId: dashboard._id.toString(),
          tileId: dashboard.tiles[0].id,
          threshold: 100,
          interval: '1h',
          source: AlertSource.TILE,
          thresholdType: AlertThresholdType.ABOVE,
          channel: {
            type: 'webhook',
            webhookId: otherTeamWebhook._id.toString(),
          },
        };

        await authRequest('post', ALERTS_BASE_URL).send(alertInput).expect(400);
      });

      it('should reject an update with a webhook belonging to another team', async () => {
        const { alert, dashboard } = await createTestAlert();
        const otherTeamWebhook = await createTestWebhook({
          teamId: new ObjectId(),
        });

        const updatePayload = {
          threshold: 200,
          interval: '1h',
          thresholdType: AlertThresholdType.ABOVE,
          source: AlertSource.TILE,
          dashboardId: dashboard._id.toString(),
          tileId: dashboard.tiles[0].id,
          channel: {
            type: 'webhook',
            webhookId: otherTeamWebhook._id.toString(),
          },
        };

        await authRequest('put', `${ALERTS_BASE_URL}/${alert.id}`)
          .send(updatePayload)
          .expect(400);
      });
    });

    describe('dashboard (TILE source) validation', () => {
      it('should reject a non-existent dashboard', async () => {
        const webhook = await createTestWebhook();

        const alertInput = {
          dashboardId: new ObjectId().toString(), // does not exist
          tileId: new ObjectId().toString(),
          threshold: 100,
          interval: '1h',
          source: AlertSource.TILE,
          thresholdType: AlertThresholdType.ABOVE,
          channel: {
            type: 'webhook',
            webhookId: webhook._id.toString(),
          },
        };

        await authRequest('post', ALERTS_BASE_URL).send(alertInput).expect(400);
      });

      it('should reject a dashboard belonging to another team', async () => {
        const webhook = await createTestWebhook();
        const otherTeamDashboard = await createTestDashboard({
          teamId: new ObjectId(),
        });

        const alertInput = {
          dashboardId: otherTeamDashboard._id.toString(),
          tileId: otherTeamDashboard.tiles[0].id,
          threshold: 100,
          interval: '1h',
          source: AlertSource.TILE,
          thresholdType: AlertThresholdType.ABOVE,
          channel: {
            type: 'webhook',
            webhookId: webhook._id.toString(),
          },
        };

        await authRequest('post', ALERTS_BASE_URL).send(alertInput).expect(400);
      });

      it('should reject an update with a dashboard belonging to another team', async () => {
        const { alert, webhook } = await createTestAlert();
        const otherTeamDashboard = await createTestDashboard({
          teamId: new ObjectId(),
        });

        const updatePayload = {
          threshold: 200,
          interval: '1h',
          thresholdType: AlertThresholdType.ABOVE,
          source: AlertSource.TILE,
          dashboardId: otherTeamDashboard._id.toString(),
          tileId: otherTeamDashboard.tiles[0].id,
          channel: {
            type: 'webhook',
            webhookId: webhook._id.toString(),
          },
        };

        await authRequest('put', `${ALERTS_BASE_URL}/${alert.id}`)
          .send(updatePayload)
          .expect(400);
      });

      it('should allow creating an alert on a raw SQL line tile', async () => {
        const webhook = await createTestWebhook();
        const { dashboard, tileId } = await createTestDashboardWithRawSqlTile({
          displayType: 'line',
          sqlTemplate: RAW_SQL_ALERT_TEMPLATE,
        });

        const alertInput = {
          dashboardId: dashboard._id.toString(),
          tileId,
          threshold: 100,
          interval: '1h',
          source: AlertSource.TILE,
          thresholdType: AlertThresholdType.ABOVE,
          channel: {
            type: 'webhook',
            webhookId: webhook._id.toString(),
          },
        };

        const res = await authRequest('post', ALERTS_BASE_URL)
          .send(alertInput)
          .expect(200);
        expect(res.body.data.dashboardId).toBe(dashboard._id.toString());
        expect(res.body.data.tileId).toBe(tileId);
      });

      it('should allow creating an alert on a raw SQL number tile', async () => {
        const webhook = await createTestWebhook();
        const { dashboard, tileId } = await createTestDashboardWithRawSqlTile({
          displayType: 'number',
          sqlTemplate: RAW_SQL_NUMBER_ALERT_TEMPLATE,
        });

        const alertInput = {
          dashboardId: dashboard._id.toString(),
          tileId,
          threshold: 100,
          interval: '1h',
          source: AlertSource.TILE,
          thresholdType: AlertThresholdType.ABOVE,
          channel: {
            type: 'webhook',
            webhookId: webhook._id.toString(),
          },
        };

        const res = await authRequest('post', ALERTS_BASE_URL)
          .send(alertInput)
          .expect(200);
        expect(res.body.data.dashboardId).toBe(dashboard._id.toString());
        expect(res.body.data.tileId).toBe(tileId);
      });

      it('should reject creating an alert on a raw SQL table tile', async () => {
        const webhook = await createTestWebhook();
        const { dashboard, tileId } = await createTestDashboardWithRawSqlTile({
          displayType: 'table',
          sqlTemplate: RAW_SQL_ALERT_TEMPLATE,
        });

        const alertInput = {
          dashboardId: dashboard._id.toString(),
          tileId,
          threshold: 100,
          interval: '1h',
          source: AlertSource.TILE,
          thresholdType: AlertThresholdType.ABOVE,
          channel: {
            type: 'webhook',
            webhookId: webhook._id.toString(),
          },
        };

        await authRequest('post', ALERTS_BASE_URL).send(alertInput).expect(400);
      });

      it('should reject creating an alert on a raw SQL tile without interval params', async () => {
        const webhook = await createTestWebhook();
        const { dashboard, tileId } = await createTestDashboardWithRawSqlTile({
          displayType: 'line',
          sqlTemplate: 'SELECT count() FROM otel_logs',
        });

        const alertInput = {
          dashboardId: dashboard._id.toString(),
          tileId,
          threshold: 100,
          interval: '1h',
          source: AlertSource.TILE,
          thresholdType: AlertThresholdType.ABOVE,
          channel: {
            type: 'webhook',
            webhookId: webhook._id.toString(),
          },
        };

        await authRequest('post', ALERTS_BASE_URL).send(alertInput).expect(400);
      });

      it('should reject updating an alert to reference a raw SQL table tile', async () => {
        const { alert, webhook } = await createTestAlert();
        const { dashboard: rawSqlDashboard, tileId: rawSqlTileId } =
          await createTestDashboardWithRawSqlTile({
            displayType: 'table',
            sqlTemplate: RAW_SQL_ALERT_TEMPLATE,
          });

        const updatePayload = {
          threshold: 200,
          interval: '1h',
          thresholdType: AlertThresholdType.ABOVE,
          source: AlertSource.TILE,
          dashboardId: rawSqlDashboard._id.toString(),
          tileId: rawSqlTileId,
          channel: {
            type: 'webhook',
            webhookId: webhook._id.toString(),
          },
        };

        await authRequest('put', `${ALERTS_BASE_URL}/${alert.id}`)
          .send(updatePayload)
          .expect(400);
      });
    });

    describe('saved search (SAVED_SEARCH source) validation', () => {
      it('should reject a non-existent saved search', async () => {
        const webhook = await createTestWebhook();

        const alertInput = {
          savedSearchId: new ObjectId().toString(), // does not exist
          threshold: 100,
          interval: '1h',
          source: AlertSource.SAVED_SEARCH,
          thresholdType: AlertThresholdType.ABOVE,
          channel: {
            type: 'webhook',
            webhookId: webhook._id.toString(),
          },
        };

        await authRequest('post', ALERTS_BASE_URL).send(alertInput).expect(400);
      });

      it('should reject a saved search belonging to another team', async () => {
        const webhook = await createTestWebhook();
        const otherTeamSavedSearch = await createTestSavedSearch({
          teamId: new ObjectId(),
        });

        const alertInput = {
          savedSearchId: otherTeamSavedSearch._id.toString(),
          threshold: 100,
          interval: '1h',
          source: AlertSource.SAVED_SEARCH,
          thresholdType: AlertThresholdType.ABOVE,
          channel: {
            type: 'webhook',
            webhookId: webhook._id.toString(),
          },
        };

        await authRequest('post', ALERTS_BASE_URL).send(alertInput).expect(400);
      });

      it('should create an alert with a valid saved search belonging to the team', async () => {
        const webhook = await createTestWebhook();
        const savedSearch = await createTestSavedSearch();

        const alertInput = {
          savedSearchId: savedSearch._id.toString(),
          threshold: 100,
          interval: '1h',
          source: AlertSource.SAVED_SEARCH,
          thresholdType: AlertThresholdType.ABOVE,
          channel: {
            type: 'webhook',
            webhookId: webhook._id.toString(),
          },
          name: 'Saved Search Alert',
        };

        const response = await authRequest('post', ALERTS_BASE_URL)
          .send(alertInput)
          .expect(200);

        expect(response.body.data.source).toBe(AlertSource.SAVED_SEARCH);
        expect(response.body.data.savedSearchId).toBe(
          savedSearch._id.toString(),
        );
      });

      it('should reject an update with a saved search belonging to another team', async () => {
        const savedSearch = await createTestSavedSearch();
        const webhook = await createTestWebhook();

        // Create a saved search alert first
        const createResponse = await authRequest('post', ALERTS_BASE_URL)
          .send({
            savedSearchId: savedSearch._id.toString(),
            threshold: 100,
            interval: '1h',
            source: AlertSource.SAVED_SEARCH,
            thresholdType: AlertThresholdType.ABOVE,
            channel: {
              type: 'webhook',
              webhookId: webhook._id.toString(),
            },
          })
          .expect(200);

        const otherTeamSavedSearch = await createTestSavedSearch({
          teamId: new ObjectId(),
        });

        const updatePayload = {
          savedSearchId: otherTeamSavedSearch._id.toString(),
          threshold: 200,
          interval: '1h',
          source: AlertSource.SAVED_SEARCH,
          thresholdType: AlertThresholdType.ABOVE,
          channel: {
            type: 'webhook',
            webhookId: webhook._id.toString(),
          },
        };

        await authRequest(
          'put',
          `${ALERTS_BASE_URL}/${createResponse.body.data.id}`,
        )
          .send(updatePayload)
          .expect(400);
      });
    });
  });

  describe('BETWEEN and NOT_BETWEEN threshold types', () => {
    it('should create an alert with BETWEEN threshold type', async () => {
      const dashboard = await createTestDashboard();
      const webhook = await createTestWebhook();

      const response = await authRequest('post', ALERTS_BASE_URL)
        .send({
          dashboardId: dashboard._id.toString(),
          tileId: dashboard.tiles[0].id,
          threshold: 50,
          thresholdMax: 200,
          interval: '1h',
          source: AlertSource.TILE,
          thresholdType: AlertThresholdType.BETWEEN,
          channel: {
            type: 'webhook',
            webhookId: webhook._id.toString(),
          },
        })
        .expect(200);

      const alert = response.body.data;
      expect(alert.threshold).toBe(50);
      expect(alert.thresholdMax).toBe(200);
      expect(alert.thresholdType).toBe(AlertThresholdType.BETWEEN);
    });

    it('should create an alert with NOT_BETWEEN threshold type', async () => {
      const dashboard = await createTestDashboard();
      const webhook = await createTestWebhook();

      const response = await authRequest('post', ALERTS_BASE_URL)
        .send({
          dashboardId: dashboard._id.toString(),
          tileId: dashboard.tiles[0].id,
          threshold: 10,
          thresholdMax: 90,
          interval: '5m',
          source: AlertSource.TILE,
          thresholdType: AlertThresholdType.NOT_BETWEEN,
          channel: {
            type: 'webhook',
            webhookId: webhook._id.toString(),
          },
        })
        .expect(200);

      const alert = response.body.data;
      expect(alert.threshold).toBe(10);
      expect(alert.thresholdMax).toBe(90);
      expect(alert.thresholdType).toBe(AlertThresholdType.NOT_BETWEEN);
    });

    it('should reject BETWEEN without thresholdMax', async () => {
      const consoleErrorSpy = jest
        .spyOn(console, 'error')
        .mockImplementation(() => {});

      const dashboard = await createTestDashboard();
      const webhook = await createTestWebhook();

      await authRequest('post', ALERTS_BASE_URL)
        .send({
          dashboardId: dashboard._id.toString(),
          tileId: dashboard.tiles[0].id,
          threshold: 50,
          interval: '1h',
          source: AlertSource.TILE,
          thresholdType: AlertThresholdType.BETWEEN,
          channel: {
            type: 'webhook',
            webhookId: webhook._id.toString(),
          },
        })
        .expect(400);

      consoleErrorSpy.mockRestore();
    });

    it('should reject BETWEEN when thresholdMax < threshold', async () => {
      const consoleErrorSpy = jest
        .spyOn(console, 'error')
        .mockImplementation(() => {});

      const dashboard = await createTestDashboard();
      const webhook = await createTestWebhook();

      await authRequest('post', ALERTS_BASE_URL)
        .send({
          dashboardId: dashboard._id.toString(),
          tileId: dashboard.tiles[0].id,
          threshold: 100,
          thresholdMax: 50,
          interval: '1h',
          source: AlertSource.TILE,
          thresholdType: AlertThresholdType.BETWEEN,
          channel: {
            type: 'webhook',
            webhookId: webhook._id.toString(),
          },
        })
        .expect(400);

      consoleErrorSpy.mockRestore();
    });

    it('should allow thresholdMax equal to threshold for BETWEEN', async () => {
      const dashboard = await createTestDashboard();
      const webhook = await createTestWebhook();

      const response = await authRequest('post', ALERTS_BASE_URL)
        .send({
          dashboardId: dashboard._id.toString(),
          tileId: dashboard.tiles[0].id,
          threshold: 100,
          thresholdMax: 100,
          interval: '1h',
          source: AlertSource.TILE,
          thresholdType: AlertThresholdType.BETWEEN,
          channel: {
            type: 'webhook',
            webhookId: webhook._id.toString(),
          },
        })
        .expect(200);

      expect(response.body.data.threshold).toBe(100);
      expect(response.body.data.thresholdMax).toBe(100);
    });

    it('should update an alert to use BETWEEN threshold type', async () => {
      const { alert, dashboard, webhook } = await createTestAlert();

      const updateResponse = await authRequest(
        'put',
        `${ALERTS_BASE_URL}/${alert.id}`,
      )
        .send({
          dashboardId: dashboard._id.toString(),
          tileId: dashboard.tiles[0].id,
          threshold: 20,
          thresholdMax: 80,
          interval: '1h',
          source: AlertSource.TILE,
          thresholdType: AlertThresholdType.BETWEEN,
          channel: {
            type: 'webhook',
            webhookId: webhook._id.toString(),
          },
        })
        .expect(200);

      const updatedAlert = updateResponse.body.data;
      expect(updatedAlert.threshold).toBe(20);
      expect(updatedAlert.thresholdMax).toBe(80);
      expect(updatedAlert.thresholdType).toBe(AlertThresholdType.BETWEEN);
    });

    it('should retrieve a BETWEEN alert with thresholdMax', async () => {
      const dashboard = await createTestDashboard();
      const webhook = await createTestWebhook();

      const createResponse = await authRequest('post', ALERTS_BASE_URL)
        .send({
          dashboardId: dashboard._id.toString(),
          tileId: dashboard.tiles[0].id,
          threshold: 10,
          thresholdMax: 50,
          interval: '1h',
          source: AlertSource.TILE,
          thresholdType: AlertThresholdType.BETWEEN,
          channel: {
            type: 'webhook',
            webhookId: webhook._id.toString(),
          },
        })
        .expect(200);

      const getResponse = await authRequest(
        'get',
        `${ALERTS_BASE_URL}/${createResponse.body.data.id}`,
      ).expect(200);

      expect(getResponse.body.data.threshold).toBe(10);
      expect(getResponse.body.data.thresholdMax).toBe(50);
      expect(getResponse.body.data.thresholdType).toBe(
        AlertThresholdType.BETWEEN,
      );
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

  describe('Errors field', () => {
    it('returns recorded execution errors on GET by id', async () => {
      const { alert } = await createTestAlert();

      const errorTimestamp = new Date('2026-04-17T12:00:00.000Z');
      await Alert.updateOne(
        { _id: alert.id },
        {
          $set: {
            executionErrors: [
              {
                timestamp: errorTimestamp,
                type: AlertErrorType.QUERY_ERROR,
                message: 'ClickHouse returned 500',
              },
            ],
          },
        },
      );

      const res = await authRequest(
        'get',
        `${ALERTS_BASE_URL}/${alert.id}`,
      ).expect(200);
      expect(res.body.data.executionErrors).toHaveLength(1);
      expect(res.body.data.executionErrors[0].type).toBe(
        AlertErrorType.QUERY_ERROR,
      );
      expect(res.body.data.executionErrors[0].message).toBe(
        'ClickHouse returned 500',
      );
      expect(res.body.data.executionErrors[0].timestamp).toBe(
        errorTimestamp.toISOString(),
      );
    });

    it('returns recorded execution errors on the list endpoint', async () => {
      const { alert } = await createTestAlert();

      await Alert.updateOne(
        { _id: alert.id },
        {
          $set: {
            executionErrors: [
              {
                timestamp: new Date('2026-04-17T12:00:00.000Z'),
                type: AlertErrorType.WEBHOOK_ERROR,
                message: 'webhook delivery failed',
              },
            ],
          },
        },
      );

      const res = await authRequest('get', ALERTS_BASE_URL).expect(200);
      const match = res.body.data.find((a: any) => a.id === alert.id);
      expect(match).toBeDefined();
      expect(match.executionErrors).toHaveLength(1);
      expect(match.executionErrors[0].type).toBe(AlertErrorType.WEBHOOK_ERROR);
      expect(match.executionErrors[0].message).toBe('webhook delivery failed');
    });
  });
});
