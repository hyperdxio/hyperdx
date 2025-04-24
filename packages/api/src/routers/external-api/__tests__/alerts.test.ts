import _ from 'lodash';

import {
  getAgent,
  getLoggedInAgent,
  getServer,
  makeAlertInput,
  makeChartConfig,
} from '../../../fixtures';
import { AlertSource, AlertThresholdType } from '../../../models/alert';

// Mock data for tests
const MOCK_DASHBOARD = {
  name: 'Test Dashboard',
  charts: [
    makeChartConfig({ id: 'chart1' }),
    makeChartConfig({ id: 'chart2' }),
    makeChartConfig({ id: 'chart3' }),
  ],
  query: 'test query',
};

describe('External API v2 Alerts', () => {
  const server = getServer();

  beforeAll(async () => {
    await server.start();
  });

  afterEach(async () => {
    await server.clearDBs();
  });

  afterAll(async () => {
    await server.stop();
  });

  it('should create, get, update, and delete alerts', async () => {
    // Setup - Create a user and login
    const { agent, user } = await getLoggedInAgent(server);

    // Create a dashboard to reference in alerts
    const dashboardResponse = await agent
      .post('/dashboards')
      .send(MOCK_DASHBOARD)
      .expect(200);
    const dashboard = dashboardResponse.body.data;

    // Test POST /v2/alerts - Create a new alert
    const alertInput = makeAlertInput({
      dashboardId: dashboard._id,
      tileId: 'chart1',
      threshold: 100,
      interval: '1h',
    });

    const createResponse = await agent
      .post('/api/v2/alerts')
      .set('Authorization', `Bearer ${user?.accessKey}`)
      .send(alertInput)
      .expect(200);

    const createdAlert = createResponse.body.data;
    expect(createdAlert).toBeTruthy();
    expect(createdAlert.threshold).toEqual(100);
    expect(createdAlert.interval).toEqual('1h');
    expect(createdAlert.tileId).toEqual('chart1');

    // Test GET /v2/alerts - Get all alerts
    const listResponse = await agent
      .get('/api/v2/alerts')
      .set('Authorization', `Bearer ${user?.accessKey}`)
      .expect(200);

    expect(listResponse.body.data).toBeInstanceOf(Array);
    expect(listResponse.body.data.length).toEqual(1);
    expect(listResponse.body.data[0].id).toEqual(createdAlert.id);

    // Test GET /v2/alerts/:id - Get a specific alert
    const getResponse = await agent
      .get(`/api/v2/alerts/${createdAlert.id}`)
      .set('Authorization', `Bearer ${user?.accessKey}`)
      .expect(200);

    expect(getResponse.body.data).toEqual(createdAlert);

    // Test PUT /v2/alerts/:id - Update an alert
    const updateInput = {
      ...alertInput,
      threshold: 200,
      interval: '5m',
      name: 'Updated Alert Name',
      message: 'Updated Alert Message',
      thresholdType: AlertThresholdType.ABOVE,
      source: AlertSource.TILE,
    };

    const updateResponse = await agent
      .put(`/api/v2/alerts/${createdAlert.id}`)
      .set('Authorization', `Bearer ${user?.accessKey}`)
      .send(updateInput)
      .expect(200);

    const updatedAlert = updateResponse.body.data;
    expect(updatedAlert.id).toEqual(createdAlert.id);
    expect(updatedAlert.threshold).toEqual(200);
    expect(updatedAlert.interval).toEqual('5m');
    expect(updatedAlert.name).toEqual('Updated Alert Name');
    expect(updatedAlert.message).toEqual('Updated Alert Message');

    // Test DELETE /v2/alerts/:id - Delete an alert
    await agent
      .delete(`/api/v2/alerts/${createdAlert.id}`)
      .set('Authorization', `Bearer ${user?.accessKey}`)
      .expect(200);

    // Verify alert was deleted
    const afterDeleteResponse = await agent
      .get('/api/v2/alerts')
      .set('Authorization', `Bearer ${user?.accessKey}`)
      .expect(200);

    expect(afterDeleteResponse.body.data).toBeInstanceOf(Array);
    expect(afterDeleteResponse.body.data.length).toEqual(0);
  });

  it('should return 404 when getting non-existent alert', async () => {
    const { agent, user } = await getLoggedInAgent(server);

    await agent
      .get('/api/v2/alerts/507f1f77bcf86cd799439011') // Valid ObjectId that doesn't exist
      .set('Authorization', `Bearer ${user?.accessKey}`)
      .expect(404);
  });

  it('should return 404 when updating non-existent alert', async () => {
    const { agent, user } = await getLoggedInAgent(server);

    // Create a dashboard to reference in the alert input
    const dashboardResponse = await agent
      .post('/dashboards')
      .send(MOCK_DASHBOARD)
      .expect(200);
    const dashboard = dashboardResponse.body.data;

    const alertInput = makeAlertInput({
      dashboardId: dashboard._id,
      tileId: 'chart1',
    });

    await agent
      .put('/api/v2/alerts/507f1f77bcf86cd799439011') // Valid ObjectId that doesn't exist
      .set('Authorization', `Bearer ${user?.accessKey}`)
      .send(alertInput)
      .expect(404);
  });

  it('should validate request input when creating/updating alerts', async () => {
    const { agent, user } = await getLoggedInAgent(server);

    // Create a dashboard to reference in the alert
    const dashboardResponse = await agent
      .post('/dashboards')
      .send(MOCK_DASHBOARD)
      .expect(200);
    const dashboard = dashboardResponse.body.data;

    // Test with invalid input - missing required fields
    const invalidInput = {
      // Missing required fields
    };

    await agent
      .post('/api/v2/alerts')
      .set('Authorization', `Bearer ${user?.accessKey}`)
      .send(invalidInput)
      .expect(400); // Expect validation error

    // Test with invalid ObjectId format
    await agent
      .get('/api/v2/alerts/invalid-id') // Invalid ObjectId format
      .set('Authorization', `Bearer ${user?.accessKey}`)
      .expect(400); // Expect validation error
  });

  it('should enforce team isolation - cannot access alerts from another team', async () => {
    // Create two users in different teams
    const { agent: agent1, user: user1 } = await getLoggedInAgent(server);
    const { agent: agent2, user: user2 } = await getLoggedInAgent(server);

    // Create a dashboard for team 1
    const dashboardResponse = await agent1
      .post('/dashboards')
      .send(MOCK_DASHBOARD)
      .expect(200);
    const dashboard = dashboardResponse.body.data;

    // Create an alert for team 1
    const alertInput = makeAlertInput({
      dashboardId: dashboard._id,
      tileId: 'chart1',
    });

    const createResponse = await agent1
      .post('/api/v2/alerts')
      .set('Authorization', `Bearer ${user1?.accessKey}`)
      .send(alertInput)
      .expect(200);

    const alertId = createResponse.body.data.id;

    // Team 2 should not be able to access Team 1's alert
    await agent2
      .get(`/api/v2/alerts/${alertId}`)
      .set('Authorization', `Bearer ${user2?.accessKey}`)
      .expect(404); // Should not find the alert

    // Team 2 should not be able to update Team 1's alert
    await agent2
      .put(`/api/v2/alerts/${alertId}`)
      .set('Authorization', `Bearer ${user2?.accessKey}`)
      .send(alertInput)
      .expect(404);

    // Team 2 should not be able to delete Team 1's alert
    await agent2
      .delete(`/api/v2/alerts/${alertId}`)
      .set('Authorization', `Bearer ${user2?.accessKey}`)
      .expect(200); // The delete operation is idempotent, so it returns 200 even if no document is deleted

    // Verify the alert still exists for Team 1
    await agent1
      .get(`/api/v2/alerts/${alertId}`)
      .set('Authorization', `Bearer ${user1?.accessKey}`)
      .expect(200);
  });

  it('should create alerts with saved search source', async () => {
    const { agent, user } = await getLoggedInAgent(server);

    // Create a saved search
    const savedSearchInput = {
      name: 'Test Saved Search',
      query: 'error',
    };

    const savedSearchResponse = await agent
      .post('/savedSearches')
      .send(savedSearchInput)
      .expect(200);

    const savedSearch = savedSearchResponse.body.data;

    // Create an alert with saved search source
    const alertInput = {
      source: AlertSource.SAVED_SEARCH,
      savedSearchId: savedSearch._id,
      channel: {
        type: 'webhook',
        webhookId: '65ad876b6b08426ab4ba7830',
      },
      interval: '15m',
      threshold: 10,
      thresholdType: AlertThresholdType.ABOVE,
      name: 'Saved Search Alert',
      message: 'Alert triggered from saved search',
    };

    const createResponse = await agent
      .post('/api/v2/alerts')
      .set('Authorization', `Bearer ${user?.accessKey}`)
      .send(alertInput)
      .expect(200);

    const createdAlert = createResponse.body.data;
    expect(createdAlert.source).toEqual(AlertSource.SAVED_SEARCH);
    expect(createdAlert.savedSearch).toEqual(savedSearch._id);
    expect(createdAlert.name).toEqual('Saved Search Alert');
  });

  it('should require authentication for all endpoints', async () => {
    const { agent } = await getLoggedInAgent(server);

    // Create an unauthenticated agent
    const unauthenticatedAgent = getAgent(server);

    // Try to access endpoints without authentication
    await unauthenticatedAgent.get('/api/v2/alerts').expect(403);

    await unauthenticatedAgent
      .get('/api/v2/alerts/507f1f77bcf86cd799439011') // Valid format but doesn't exist
      .expect(403);

    // Create a dashboard to reference in the alert
    const dashboardResponse = await agent
      .post('/dashboards')
      .send(MOCK_DASHBOARD)
      .expect(200);
    const dashboard = dashboardResponse.body.data;

    const alertInput = makeAlertInput({
      dashboardId: dashboard._id,
      tileId: 'chart1',
    });

    await unauthenticatedAgent
      .post('/api/v2/alerts')
      .send(alertInput)
      .expect(403);

    await unauthenticatedAgent
      .put('/api/v2/alerts/507f1f77bcf86cd799439011')
      .send(alertInput)
      .expect(403);

    await unauthenticatedAgent
      .delete('/api/v2/alerts/507f1f77bcf86cd799439011')
      .expect(403);
  });
});
