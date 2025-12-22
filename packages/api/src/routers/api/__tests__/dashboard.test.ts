import {
  AlertThresholdType,
  MetricsDataType,
  PresetDashboard,
  SourceKind,
  TSourceUnion,
} from '@hyperdx/common-utils/dist/types';
import { omit } from 'lodash';
import mongoose, { Types } from 'mongoose';

import PresetDashboardFilter from '@/models/presetDashboardFilter';
import { Source } from '@/models/source';

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

  describe('preset dashboards', () => {
    const MOCK_SOURCE: Omit<Extract<TSourceUnion, { kind: 'log' }>, 'id'> = {
      kind: SourceKind.Log,
      name: 'Test Source',
      connection: new Types.ObjectId().toString(),
      from: {
        databaseName: 'test_db',
        tableName: 'test_table',
      },
      timestampValueExpression: 'timestamp',
      defaultTableSelectExpression: 'body',
    };

    const MOCK_PRESET_DASHBOARD_FILTER = {
      name: 'Test Filter',
      type: 'QUERY_EXPRESSION',
      expression: 'service.name:test-service',
      presetDashboard: PresetDashboard.Services,
    };

    describe('GET /preset/:presetDashboard/filters', () => {
      it('returns preset dashboard filters for a given source', async () => {
        const { agent, team } = await getLoggedInAgent(server);

        // Create a test source
        const source = await Source.create({
          ...MOCK_SOURCE,
          team: team._id,
        });

        // Create a preset dashboard filter
        const filter = await PresetDashboardFilter.create({
          ...MOCK_PRESET_DASHBOARD_FILTER,
          team: team._id,
          source: source._id,
        });

        const response = await agent
          .get(`/dashboards/preset/${PresetDashboard.Services}/filters`)
          .query({ sourceId: source._id.toString() })
          .expect(200);

        expect(response.body).toHaveLength(1);
        expect(response.body[0]).toMatchObject({
          name: MOCK_PRESET_DASHBOARD_FILTER.name,
          type: MOCK_PRESET_DASHBOARD_FILTER.type,
          expression: MOCK_PRESET_DASHBOARD_FILTER.expression,
          presetDashboard: MOCK_PRESET_DASHBOARD_FILTER.presetDashboard,
          source: source._id.toString(),
          id: filter._id.toString(),
        });
      });

      it('returns empty array when no filters exist for source', async () => {
        const { agent, team } = await getLoggedInAgent(server);

        const source = await Source.create({
          ...MOCK_SOURCE,
          team: team._id,
        });

        const response = await agent
          .get(`/dashboards/preset/${PresetDashboard.Services}/filters`)
          .query({ sourceId: source._id.toString() })
          .expect(200);

        expect(response.body).toEqual([]);
      });

      it('returns 400 when sourceId is missing', async () => {
        const { agent } = await getLoggedInAgent(server);

        await agent
          .get(`/dashboards/preset/${PresetDashboard.Services}/filters`)
          .expect(400);
      });

      it('returns 400 when sourceId is empty', async () => {
        const { agent } = await getLoggedInAgent(server);

        await agent
          .get(`/dashboards/preset/${PresetDashboard.Services}/filters`)
          .query({ sourceId: '' })
          .expect(400);
      });

      it('returns 400 for invalid preset dashboard type', async () => {
        const { agent, team } = await getLoggedInAgent(server);

        const source = await Source.create({
          ...MOCK_SOURCE,
          team: team._id,
        });

        await agent
          .get('/dashboards/preset/invalid-dashboard/filters')
          .query({ sourceId: source._id.toString() })
          .expect(400);
      });

      it('does not return filters from other teams in GET', async () => {
        const { agent: agent1, team: team1 } = await getLoggedInAgent(server);
        const team2 = new mongoose.Types.ObjectId();

        const source1 = await Source.create({
          ...MOCK_SOURCE,
          team: team1._id,
        });

        const source2 = await Source.create({
          ...MOCK_SOURCE,
          team: team2,
        });

        await PresetDashboardFilter.create({
          ...MOCK_PRESET_DASHBOARD_FILTER,
          team: team1._id,
          source: source1._id,
        });

        await PresetDashboardFilter.create({
          ...MOCK_PRESET_DASHBOARD_FILTER,
          team: team2,
          source: source2._id,
        });

        const response = await agent1
          .get(`/dashboards/preset/${PresetDashboard.Services}/filters`)
          .query({ sourceId: source1._id.toString() })
          .expect(200);

        expect(response.body).toHaveLength(1);
        expect(response.body[0].team).toEqual(team1._id.toString());
      });
    });

    describe('POST /preset/:presetDashboard/filter', () => {
      it('creates a new preset dashboard filter', async () => {
        const { agent, team } = await getLoggedInAgent(server);

        const source = await Source.create({
          ...MOCK_SOURCE,
          team: team._id,
        });

        const filterInput = {
          ...MOCK_PRESET_DASHBOARD_FILTER,
          id: new Types.ObjectId().toString(),
          source: source._id.toString(),
        };

        const response = await agent
          .post(`/dashboards/preset/${PresetDashboard.Services}/filter`)
          .send({ filter: filterInput })
          .expect(200);

        expect(response.body).toMatchObject({
          name: MOCK_PRESET_DASHBOARD_FILTER.name,
          type: MOCK_PRESET_DASHBOARD_FILTER.type,
          expression: MOCK_PRESET_DASHBOARD_FILTER.expression,
          presetDashboard: MOCK_PRESET_DASHBOARD_FILTER.presetDashboard,
        });

        // Verify filter was created in database
        const filters = await PresetDashboardFilter.find({ team: team._id });
        expect(filters).toHaveLength(1);
        expect(filters[0]._id.toString()).toBe(response.body.id);
        expect(filters[0].source.toString()).toBe(source._id.toString());
        expect(filters[0].team.toString()).toBe(team._id.toString());
        expect(filters[0].name).toBe(MOCK_PRESET_DASHBOARD_FILTER.name);
        expect(filters[0].type).toBe(MOCK_PRESET_DASHBOARD_FILTER.type);
        expect(filters[0].expression).toBe(
          MOCK_PRESET_DASHBOARD_FILTER.expression,
        );
        expect(filters[0].presetDashboard).toBe(
          MOCK_PRESET_DASHBOARD_FILTER.presetDashboard,
        );
      });

      it('creates filter with optional sourceMetricType', async () => {
        const { agent, team } = await getLoggedInAgent(server);

        const source = await Source.create({
          ...MOCK_SOURCE,
          team: team._id,
        });

        const filterInput = {
          ...MOCK_PRESET_DASHBOARD_FILTER,
          id: new Types.ObjectId().toString(),
          source: source._id.toString(),
          sourceMetricType: MetricsDataType.Gauge,
        };

        const response = await agent
          .post(`/dashboards/preset/${PresetDashboard.Services}/filter`)
          .send({ filter: filterInput })
          .expect(200);

        expect(response.body.sourceMetricType).toBe(MetricsDataType.Gauge);
      });

      it('returns 400 when filter preset dashboard does not match params', async () => {
        const { agent, team } = await getLoggedInAgent(server);

        const source = await Source.create({
          ...MOCK_SOURCE,
          team: team._id,
        });

        const filterInput = {
          ...MOCK_PRESET_DASHBOARD_FILTER,
          id: new Types.ObjectId().toString(),
          source: source._id.toString(),
          presetDashboard: PresetDashboard.Services,
        };

        // Try to create with mismatched preset dashboard in URL
        await agent
          .post('/dashboards/preset/invalid-dashboard/filter')
          .send({ filter: filterInput })
          .expect(400);
      });

      it('returns 400 when filter is missing required fields', async () => {
        const { agent, team } = await getLoggedInAgent(server);

        const source = await Source.create({
          ...MOCK_SOURCE,
          team: team._id,
        });

        const incompleteFilter = {
          name: 'Test Filter',
          source: source._id.toString(),
          // Missing type, expression, presetDashboard
        };

        await agent
          .post(`/dashboards/preset/${PresetDashboard.Services}/filter`)
          .send({ filter: incompleteFilter })
          .expect(400);
      });

      it('returns 400 when filter body is missing', async () => {
        const { agent } = await getLoggedInAgent(server);

        await agent
          .post(`/dashboards/preset/${PresetDashboard.Services}/filter`)
          .send({})
          .expect(400);
      });
    });

    describe('PUT /preset/:presetDashboard/filter', () => {
      it('updates an existing preset dashboard filter', async () => {
        const { agent, team } = await getLoggedInAgent(server);

        const source = await Source.create({
          ...MOCK_SOURCE,
          team: team._id,
        });

        // Create initial filter
        const existingFilter = await PresetDashboardFilter.create({
          ...MOCK_PRESET_DASHBOARD_FILTER,
          team: team._id,
          source: source._id,
        });

        const updatedFilterInput = {
          id: existingFilter._id.toString(),
          name: 'Updated Filter Name',
          type: MOCK_PRESET_DASHBOARD_FILTER.type,
          expression: 'service.name:updated-service',
          presetDashboard: MOCK_PRESET_DASHBOARD_FILTER.presetDashboard,
          source: source._id.toString(),
        };

        const response = await agent
          .put(`/dashboards/preset/${PresetDashboard.Services}/filter`)
          .send({ filter: updatedFilterInput })
          .expect(200);

        expect(response.body).toMatchObject({
          name: 'Updated Filter Name',
          expression: 'service.name:updated-service',
        });

        // Verify filter was updated in database
        const updatedFilter = await PresetDashboardFilter.findById(
          existingFilter._id,
        );
        expect(updatedFilter?.name).toBe('Updated Filter Name');
        expect(updatedFilter?.expression).toBe('service.name:updated-service');
      });

      it('returns an error when the filter does not exist', async () => {
        const { agent, team } = await getLoggedInAgent(server);

        const source = await Source.create({
          ...MOCK_SOURCE,
          team: team._id,
        });

        const newFilterInput = {
          id: new Types.ObjectId().toString(),
          name: 'New Filter',
          type: MOCK_PRESET_DASHBOARD_FILTER.type,
          expression: 'service.name:new-service',
          presetDashboard: MOCK_PRESET_DASHBOARD_FILTER.presetDashboard,
          source: source._id.toString(),
        };

        await agent
          .put(`/dashboards/preset/${PresetDashboard.Services}/filter`)
          .send({ filter: newFilterInput })
          .expect(404);
      });

      it('updates filter with sourceMetricType', async () => {
        const { agent, team } = await getLoggedInAgent(server);

        const source = await Source.create({
          ...MOCK_SOURCE,
          team: team._id,
        });

        const existingFilter = await PresetDashboardFilter.create({
          ...MOCK_PRESET_DASHBOARD_FILTER,
          team: team._id,
          source: source._id,
        });

        const updatedFilterInput = {
          id: existingFilter._id.toString(),
          name: MOCK_PRESET_DASHBOARD_FILTER.name,
          type: MOCK_PRESET_DASHBOARD_FILTER.type,
          expression: MOCK_PRESET_DASHBOARD_FILTER.expression,
          presetDashboard: MOCK_PRESET_DASHBOARD_FILTER.presetDashboard,
          source: source._id.toString(),
          sourceMetricType: MetricsDataType.Histogram,
        };

        const response = await agent
          .put(`/dashboards/preset/${PresetDashboard.Services}/filter`)
          .send({ filter: updatedFilterInput })
          .expect(200);

        expect(response.body.sourceMetricType).toBe(MetricsDataType.Histogram);
      });

      it('returns 400 when filter preset dashboard does not match params', async () => {
        const { agent, team } = await getLoggedInAgent(server);

        const source = await Source.create({
          ...MOCK_SOURCE,
          team: team._id,
        });

        const filterInput = {
          id: new Types.ObjectId().toString(),
          name: 'Test Filter',
          type: MOCK_PRESET_DASHBOARD_FILTER.type,
          expression: 'test',
          presetDashboard: PresetDashboard.Services,
          source: source._id.toString(),
        };

        // Try to update with mismatched preset dashboard in URL
        await agent
          .put('/dashboards/preset/invalid-dashboard/filter')
          .send({ filter: filterInput })
          .expect(400);
      });

      it('returns 400 when filter is missing required fields', async () => {
        const { agent } = await getLoggedInAgent(server);

        const incompleteFilter = {
          id: new Types.ObjectId().toString(),
          name: 'Test Filter',
          // Missing type, expression, presetDashboard, source
        };

        await agent
          .put(`/dashboards/preset/${PresetDashboard.Services}/filter`)
          .send({ filter: incompleteFilter })
          .expect(400);
      });
    });

    describe('DELETE /preset/:presetDashboard/filter/:id', () => {
      it('deletes a preset dashboard filter', async () => {
        const { agent, team } = await getLoggedInAgent(server);

        const source = await Source.create({
          ...MOCK_SOURCE,
          team: team._id,
        });

        // Create a filter to delete
        const filter = await PresetDashboardFilter.create({
          ...MOCK_PRESET_DASHBOARD_FILTER,
          team: team._id,
          source: source._id,
        });

        const response = await agent
          .delete(
            `/dashboards/preset/${PresetDashboard.Services}/filter/${filter._id}`,
          )
          .expect(200);

        expect(response.body).toMatchObject({
          id: filter._id.toString(),
        });

        // Verify filter was deleted from database
        const deletedFilter = await PresetDashboardFilter.findById(filter._id);
        expect(deletedFilter).toBeNull();
      });

      it('returns 404 when filter does not exist', async () => {
        const { agent } = await getLoggedInAgent(server);

        const nonExistentId = new Types.ObjectId().toString();

        await agent
          .delete(
            `/dashboards/preset/${PresetDashboard.Services}/filter/${nonExistentId}`,
          )
          .expect(404);
      });

      it('returns 400 when id is invalid', async () => {
        const { agent } = await getLoggedInAgent(server);

        await agent
          .delete('/dashboards/preset/services/filter/invalid-id')
          .expect(400);
      });

      it('returns 400 for invalid preset dashboard type', async () => {
        const { agent } = await getLoggedInAgent(server);

        const filterId = new Types.ObjectId().toString();

        await agent
          .delete(`/dashboards/preset/invalid-dashboard/filter/${filterId}`)
          .expect(400);
      });

      it('does not delete filters from other teams', async () => {
        const { agent: agent } = await getLoggedInAgent(server); // team 1
        const team2Id = new mongoose.Types.ObjectId();

        const source = await Source.create({
          ...MOCK_SOURCE,
          team: team2Id,
        });

        const filter = await PresetDashboardFilter.create({
          ...MOCK_PRESET_DASHBOARD_FILTER,
          team: team2Id,
          source: source._id,
        });

        // Try to delete team2's filter as team1
        await agent
          .delete(
            `/dashboards/preset/${PresetDashboard.Services}/filter/${filter._id}`,
          )
          .expect(404);

        // Verify filter still exists for team2
        const stillExistingFilter = await PresetDashboardFilter.findById(
          filter._id,
        );
        expect(stillExistingFilter).toBeTruthy();
      });
    });
  });
});
