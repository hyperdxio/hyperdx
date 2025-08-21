import { AlertThresholdType } from '@hyperdx/common-utils/dist/types';
import { omit } from 'lodash';

import {
  getLoggedInAgent,
  getServer,
  makeAlertInput,
  makeTile,
} from '@/fixtures';

const MOCK_DASHBOARD = {
  name: 'Test Dashboard',
  tiles: [makeTile(), makeTile(), makeTile(), makeTile(), makeTile()],
  tags: ['test'],
};

const MOCK_ALERT = {
  channel: { type: 'webhook' as const, webhookId: 'abcde' },
  interval: '12h' as const,
  threshold: 1,
  thresholdType: AlertThresholdType.ABOVE,
};

describe('dashboard router', () => {
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

  it('can create a dashboard', async () => {
    const { agent } = await getLoggedInAgent(server);
    const dashboard = await agent
      .post('/dashboards')
      .send(MOCK_DASHBOARD)
      .expect(200);
    expect(dashboard.body.name).toBe(MOCK_DASHBOARD.name);
    expect(dashboard.body.tiles.length).toBe(MOCK_DASHBOARD.tiles.length);
    expect(dashboard.body.tiles.map(tile => tile.id)).toEqual(
      MOCK_DASHBOARD.tiles.map(tile => tile.id),
    );
  });

  it('can update a dashboard', async () => {
    const { agent } = await getLoggedInAgent(server);
    const dashboard = await agent
      .post('/dashboards')
      .send(MOCK_DASHBOARD)
      .expect(200);

    const updatedDashboard = await agent
      .patch(`/dashboards/${dashboard.body.id}`)
      .send({
        ...dashboard.body,
        name: 'Updated Dashboard',
        tiles: dashboard.body.tiles.slice(1),
      })
      .expect(200);
    expect(updatedDashboard.body.name).toBe('Updated Dashboard');
    expect(updatedDashboard.body.tiles.length).toBe(
      dashboard.body.tiles.length - 1,
    );
    expect(updatedDashboard.body.tiles.map(tile => tile.id)).toEqual(
      dashboard.body.tiles.slice(1).map(tile => tile.id),
    );
  });

  it('can delete a dashboard', async () => {
    const { agent } = await getLoggedInAgent(server);
    const dashboard = await agent
      .post('/dashboards')
      .send(MOCK_DASHBOARD)
      .expect(200);
    await agent.delete(`/dashboards/${dashboard.body.id}`).expect(204);
    const dashboards = await agent.get('/dashboards').expect(200);
    expect(dashboards.body.length).toBe(0);
  });

  it('alerts are created when creating dashboard', async () => {
    const { agent } = await getLoggedInAgent(server);
    const dashboard = await agent
      .post('/dashboards')
      .send({
        name: 'Test Dashboard',
        tiles: [makeTile({ alert: MOCK_ALERT })],
        tags: [],
      })
      .expect(200);

    const alerts = await agent.get(`/alerts`).expect(200);
    expect(alerts.body.data).toMatchObject([
      {
        ...omit(MOCK_ALERT, 'channel.webhookId'),
        tileId: dashboard.body.tiles[0].id,
      },
    ]);
  });

  it('alerts are created when updating dashboard (adding alert to tile)', async () => {
    const { agent } = await getLoggedInAgent(server);
    const dashboard = await agent
      .post('/dashboards')
      .send(MOCK_DASHBOARD)
      .expect(200);

    const updatedDashboard = await agent
      .patch(`/dashboards/${dashboard.body.id}`)
      .send({
        ...dashboard.body,
        tiles: [...dashboard.body.tiles, makeTile({ alert: MOCK_ALERT })],
      })
      .expect(200);

    const alerts = await agent.get(`/alerts`).expect(200);
    expect(alerts.body.data).toMatchObject([
      {
        ...omit(MOCK_ALERT, 'channel.webhookId'),
        tileId: updatedDashboard.body.tiles[MOCK_DASHBOARD.tiles.length].id,
      },
    ]);
  });

  it('alerts are deleted when updating dashboard (deleting tile alert settings)', async () => {
    const { agent } = await getLoggedInAgent(server);
    const dashboard = await agent
      .post('/dashboards')
      .send({
        name: 'Test Dashboard',
        tiles: [makeTile({ alert: MOCK_ALERT })],
        tags: [],
      })
      .expect(200);

    await agent
      .patch(`/dashboards/${dashboard.body.id}`)
      .send({
        ...dashboard.body,
        tiles: dashboard.body.tiles.slice(1),
      })
      .expect(200);

    const alerts = await agent.get(`/alerts`).expect(200);
    expect(alerts.body.data).toEqual([]);
  });

  it('alerts are updated when updating dashboard (updating tile alert settings)', async () => {
    const { agent } = await getLoggedInAgent(server);
    const dashboard = await agent
      .post('/dashboards')
      .send({
        name: 'Test Dashboard',
        tiles: [makeTile({ alert: MOCK_ALERT })],
        tags: [],
      })
      .expect(200);

    const updatedAlert = {
      ...MOCK_ALERT,
      threshold: 2,
    };

    await agent
      .patch(`/dashboards/${dashboard.body.id}`)
      .send({
        ...dashboard.body,
        tiles: [
          {
            ...dashboard.body.tiles[0],
            config: {
              ...dashboard.body.tiles[0].config,
              alert: updatedAlert,
            },
          },
        ],
      })
      .expect(200);

    const alerts = await agent.get(`/alerts`).expect(200);
    expect(alerts.body.data).toMatchObject([
      {
        ...omit(updatedAlert, 'channel.webhookId'),
        tileId: dashboard.body.tiles[0].id,
      },
    ]);
  });

  it('preserves alert creator when different user edits tile alert settings', async () => {
    // This test reproduces the exact issue described in the ticket

    // User A creates dashboard with alert
    const { agent: agentA, user: userA } = await getLoggedInAgent(server);
    const dashboard = await agentA
      .post('/dashboards')
      .send({
        name: 'Test Dashboard',
        tiles: [makeTile({ alert: MOCK_ALERT })],
        tags: [],
      })
      .expect(200);

    // Verify alert was created with User A as creator
    let alerts = await agentA.get(`/alerts`).expect(200);
    expect(alerts.body.data).toHaveLength(1);
    expect(alerts.body.data[0].createdBy?.email).toBe(userA.email);
    const originalAlertId = alerts.body.data[0]._id;

    // User B edits the alert threshold (simulating the bug scenario)
    const { agent: agentB, user: userB } = await getLoggedInAgent(server);

    // Get dashboard as User B would see it (with populated alert data including _id)
    const dashboards = await agentB.get('/dashboards').expect(200);
    const dashboardWithAlerts = dashboards.body.find(
      d => d.id === dashboard.body.id,
    );

    const updatedAlert = {
      ...dashboardWithAlerts.tiles[0].config.alert,
      threshold: 5, // Change threshold from 1 to 5
    };

    await agentB
      .patch(`/dashboards/${dashboard.body.id}`)
      .send({
        ...dashboardWithAlerts,
        tiles: [
          {
            ...dashboardWithAlerts.tiles[0],
            config: {
              ...dashboardWithAlerts.tiles[0].config,
              alert: updatedAlert,
            },
          },
        ],
      })
      .expect(200);

    // Verify alert was updated, not recreated
    alerts = await agentB.get(`/alerts`).expect(200);
    expect(alerts.body.data).toHaveLength(1);

    // CRITICAL: Creator should still be User A, not User B
    expect(alerts.body.data[0].createdBy?.email).toBe(userA.email);
    expect(alerts.body.data[0].createdBy?.email).not.toBe(userB.email);

    // Alert ID should be the same (updated, not recreated)
    expect(alerts.body.data[0]._id).toBe(originalAlertId);

    // Threshold should be updated
    expect(alerts.body.data[0].threshold).toBe(5);
  });

  it('deletes attached alerts when deleting tiles', async () => {
    const { agent } = await getLoggedInAgent(server);

    await agent.post('/dashboards').send(MOCK_DASHBOARD).expect(200);
    const initialDashboards = await agent.get('/dashboards').expect(200);

    // Create alerts for all charts
    const dashboard = initialDashboards.body[0];
    await Promise.all(
      dashboard.tiles.map(tile =>
        agent
          .post('/alerts')
          .send(
            makeAlertInput({
              dashboardId: dashboard._id,
              tileId: tile.id,
            }),
          )
          .expect(200),
      ),
    );

    // Make sure all alerts are attached to the dashboard charts
    const allTiles = dashboard.tiles.map(tile => tile.id).sort();
    const alertsPreDelete = await agent.get(`/alerts`).expect(200);
    const alertsPreDeleteTiles = alertsPreDelete.body.data
      .map(alert => alert.tileId)
      .sort();
    expect(allTiles).toEqual(alertsPreDeleteTiles);

    // Delete the first chart
    const dashboardPreDelete = await agent
      .get('/dashboards')
      .expect(200)
      .then(res => res.body[0]);
    await agent
      .patch(`/dashboards/${dashboard._id}`)
      .send({
        ...dashboardPreDelete,
        tiles: dashboardPreDelete.tiles.slice(1),
      })
      .expect(200);

    const dashboardPostDelete = await agent
      .get('/dashboards')
      .expect(200)
      .then(res => res.body[0]);

    // Make sure all alerts are attached to the dashboard charts
    const allTilesPostDelete = dashboardPostDelete.tiles
      .map(tile => tile.id)
      .sort();
    const alertsPostDelete = await agent.get(`/alerts`).expect(200);
    const alertsPostDeleteTiles = alertsPostDelete.body.data
      .map(alert => alert.tileId)
      .sort();
    expect(allTilesPostDelete).toEqual(alertsPostDeleteTiles);
  });
});
