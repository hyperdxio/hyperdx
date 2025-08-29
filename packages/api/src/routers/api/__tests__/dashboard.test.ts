import { AlertThresholdType } from '@hyperdx/common-utils/dist/types';
import { omit } from 'lodash';
import mongoose from 'mongoose';

import {
  getLoggedInAgent,
  getServer,
  makeAlertInput,
  makeTile,
} from '../../../fixtures';
import Alert from '../../../models/alert';

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

  it('alerts are deleted when removing alert from tile (keeping tile)', async () => {
    const { agent } = await getLoggedInAgent(server);
    const dashboard = await agent
      .post('/dashboards')
      .send({
        name: 'Test Dashboard',
        tiles: [makeTile({ alert: MOCK_ALERT })],
        tags: [],
      })
      .expect(200);

    // Remove alert from tile but keep the tile
    await agent
      .patch(`/dashboards/${dashboard.body.id}`)
      .send({
        ...dashboard.body,
        tiles: [
          {
            ...dashboard.body.tiles[0],
            config: {
              ...dashboard.body.tiles[0].config,
              alert: undefined, // Remove the alert
            },
          },
        ],
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

  it('preserves alert creator when different user updates dashboard', async () => {
    const { agent, user: currentUser } = await getLoggedInAgent(server);

    // Arrange: Create dashboard with alert
    const dashboardResponse = await agent
      .post('/dashboards')
      .send({
        name: 'Test Dashboard',
        tiles: [makeTile({ alert: MOCK_ALERT })],
        tags: [],
      })
      .expect(200);

    const dashboard = dashboardResponse.body;
    const tileId = dashboard.tiles[0].id;

    // Setup: Simulate alert created by different user
    const originalAlert = await Alert.findOne({ tileId });

    if (!originalAlert) {
      throw new Error('Original alert not found');
    }

    // Set the original creator to a different user
    const originalCreatorId = new mongoose.Types.ObjectId();
    originalAlert.createdBy = originalCreatorId;
    await originalAlert.save({ validateBeforeSave: false });

    // Act: Current user updates the dashboard (modifies alert threshold)
    const updatedThreshold = 5;
    const updatedAlert = {
      ...MOCK_ALERT,
      threshold: updatedThreshold,
    };

    await agent
      .patch(`/dashboards/${dashboard.id}`)
      .send({
        ...dashboard,
        tiles: [
          {
            ...dashboard.tiles[0],
            config: {
              ...dashboard.tiles[0].config,
              alert: updatedAlert,
            },
          },
        ],
      })
      .expect(200);

    // Assert: Verify alert preserves original creator and updates threshold
    const updatedAlertRecord = await Alert.findOne({ tileId });
    expect(updatedAlertRecord).toBeTruthy();

    if (!updatedAlertRecord) {
      throw new Error('Updated alert record not found');
    }

    // Alert should preserve original creator
    if (!updatedAlertRecord.createdBy) {
      throw new Error('Updated alert record has no creator');
    }

    expect(updatedAlertRecord.createdBy.toString()).toBe(
      originalCreatorId.toString(),
    );
    expect(updatedAlertRecord.createdBy.toString()).not.toBe(
      currentUser._id.toString(),
    );

    // Alert should have updated threshold
    expect(updatedAlertRecord.threshold).toBe(updatedThreshold);
  });
});
