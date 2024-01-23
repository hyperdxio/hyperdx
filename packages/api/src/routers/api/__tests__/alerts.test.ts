import {
  clearDBCollections,
  closeDB,
  getLoggedInAgent,
  getServer,
  makeAlert,
  makeChart,
} from '@/fixtures';

const MOCK_DASHBOARD = {
  name: 'Test Dashboard',
  charts: [makeChart(), makeChart(), makeChart(), makeChart(), makeChart()],
  query: 'test query',
};

describe('alerts router', () => {
  const server = getServer();

  beforeAll(async () => {
    await server.start();
  });

  afterEach(async () => {
    await clearDBCollections();
  });

  afterAll(async () => {
    await server.closeHttpServer();
    await closeDB();
  });

  it('has alerts attached to dashboards', async () => {
    const { agent } = await getLoggedInAgent(server);

    await agent.post('/dashboards').send(MOCK_DASHBOARD).expect(200);
    const initialDashboards = await agent.get('/dashboards').expect(200);

    // Create alerts for all charts
    const dashboard = initialDashboards.body.data[0];
    await Promise.all(
      dashboard.charts.map(chart =>
        agent
          .post('/alerts')
          .send(
            makeAlert({
              dashboardId: dashboard._id,
              chartId: chart.id,
            }),
          )
          .expect(200),
      ),
    );

    const alerts = await agent.get(`/alerts`).expect(200);
    expect(alerts.body.data.length).toBe(5);
    for (const alert of alerts.body.data) {
      expect(alert.chartId).toBeDefined();
      expect(alert.dashboard).toBeDefined();
    }
  });
});
