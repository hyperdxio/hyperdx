import { getLoggedInAgent, getServer, makeAlert, makeTile } from '@/fixtures';

const MOCK_DASHBOARD = {
  name: 'Test Dashboard',
  tiles: [makeTile(), makeTile(), makeTile(), makeTile(), makeTile()],
  tags: ['test'],
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
            makeAlert({
              dashboardId: dashboard._id,
              tileId: tile.id,
            }),
          )
          .expect(200),
      ),
    );

    const dashboards = await agent.get(`/dashboards`).expect(200);

    // Make sure all alerts are attached to the dashboard charts
    const allTiles = dashboard.tiles.map(tile => tile.id).sort();
    const tilesWithAlerts = dashboards.body[0].alerts
      .map(alert => alert.tileId)
      .sort();
    expect(allTiles).toEqual(tilesWithAlerts);

    // Delete the first chart
    await agent
      .patch(`/dashboards/${dashboard._id}`)
      .send({
        ...dashboard,
        tiles: dashboard.tiles.slice(1),
      })
      .expect(200);

    const dashboardPostDelete = (await agent.get(`/dashboards`).expect(200))
      .body[0];

    // Make sure all alerts are attached to the dashboard charts
    const allTilesPostDelete = dashboardPostDelete.tiles
      .map(tile => tile.id)
      .sort();
    const tilesWithAlertsPostDelete = dashboardPostDelete.alerts
      .map(alert => alert.tileId)
      .sort();
    expect(allTilesPostDelete).toEqual(tilesWithAlertsPostDelete);
  });
});
