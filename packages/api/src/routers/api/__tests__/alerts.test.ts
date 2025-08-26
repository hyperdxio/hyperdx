import {
  getLoggedInAgent,
  getServer,
  makeAlertInput,
  makeTile,
  randomMongoId,
} from '@/fixtures';
import Alert from '@/models/alert';

const MOCK_TILES = [makeTile(), makeTile(), makeTile(), makeTile(), makeTile()];

const MOCK_DASHBOARD = {
  id: randomMongoId(),
  name: 'Test Dashboard',
  tiles: MOCK_TILES,
  tags: ['test'],
};

describe('alerts router', () => {
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

  it('can create an alert', async () => {
    const { agent } = await getLoggedInAgent(server);
    const dashboard = await agent
      .post('/dashboards')
      .send(MOCK_DASHBOARD)
      .expect(200);
    const alert = await agent
      .post('/alerts')
      .send(
        makeAlertInput({
          dashboardId: dashboard.body.id,
          tileId: dashboard.body.tiles[0].id,
        }),
      )
      .expect(200);
    expect(alert.body.data.dashboard).toBe(dashboard.body.id);
    expect(alert.body.data.tileId).toBe(dashboard.body.tiles[0].id);
  });

  it('can delete an alert', async () => {
    const { agent } = await getLoggedInAgent(server);
    const resp = await agent
      .post('/dashboards')
      .send(MOCK_DASHBOARD)
      .expect(200);
    const alert = await agent
      .post('/alerts')
      .send(
        makeAlertInput({
          dashboardId: resp.body.id,
          tileId: MOCK_TILES[0].id,
        }),
      )
      .expect(200);
    await agent.delete(`/alerts/${alert.body.data._id}`).expect(200);
    const alerts = await agent.get('/alerts').expect(200);
    expect(alerts.body.data.length).toBe(0);
  });

  it('can update an alert', async () => {
    const { agent } = await getLoggedInAgent(server);
    const dashboard = await agent
      .post('/dashboards')
      .send(MOCK_DASHBOARD)
      .expect(200);
    const alert = await agent
      .post('/alerts')
      .send(
        makeAlertInput({
          dashboardId: dashboard.body.id,
          tileId: MOCK_TILES[0].id,
        }),
      )
      .expect(200);
    await agent
      .put(`/alerts/${alert.body.data._id}`)
      .send({
        ...alert.body.data,
        dashboardId: dashboard.body.id, // because alert.body.data stores 'dashboard' instead of 'dashboardId'
        threshold: 10,
      })
      .expect(200);
    const allAlerts = await agent.get(`/alerts`).expect(200);
    expect(allAlerts.body.data.length).toBe(1);
    expect(allAlerts.body.data[0].threshold).toBe(10);
  });

  it('preserves createdBy field during updates', async () => {
    const { agent, user } = await getLoggedInAgent(server);
    const dashboard = await agent
      .post('/dashboards')
      .send(MOCK_DASHBOARD)
      .expect(200);

    // Create an alert
    const alert = await agent
      .post('/alerts')
      .send(
        makeAlertInput({
          dashboardId: dashboard.body.id,
          tileId: dashboard.body.tiles[0].id,
          threshold: 5,
        }),
      )
      .expect(200);

    // Verify alert was created and contains the expected data
    expect(alert.body.data.threshold).toBe(5);

    // Get the alert directly from database to verify createdBy was set
    const alertFromDb = await Alert.findById(alert.body.data._id);
    expect(alertFromDb).toBeDefined();
    expect(alertFromDb!.createdBy).toEqual(user._id);
    expect(alertFromDb!.threshold).toBe(5);

    // Update the alert with a different threshold
    const updatedAlert = await agent
      .put(`/alerts/${alert.body.data._id}`)
      .send({
        ...alert.body.data,
        dashboardId: dashboard.body.id, // because alert.body.data stores 'dashboard' instead of 'dashboardId'
        threshold: 15, // Change threshold
      })
      .expect(200);

    expect(updatedAlert.body.data.threshold).toBe(15);

    // Get the alert from database again to verify createdBy is preserved
    const alertFromDbAfterUpdate = await Alert.findById(alert.body.data._id);
    expect(alertFromDbAfterUpdate).toBeDefined();
    expect(alertFromDbAfterUpdate!.createdBy).toEqual(user._id); // ✅ createdBy should still be the original user
    expect(alertFromDbAfterUpdate!.threshold).toBe(15); // ✅ threshold should be updated
  });

  it('has alerts attached to dashboards', async () => {
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

    const alerts = await agent.get(`/alerts`).expect(200);
    expect(alerts.body.data.length).toBe(5);
    for (const alert of alerts.body.data) {
      expect(alert.tileId).toBeDefined();
      expect(alert.dashboard).toBeDefined();
    }
  });
});
