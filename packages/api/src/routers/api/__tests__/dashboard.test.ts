import { getLoggedInAgent, getServer, makeAlert, makeTile } from '@/fixtures';

const MOCK_DASHBOARD = {
  id: '1',
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
