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

describe('dashboard router', () => {
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

  it('deletes attached alerts when deleting charts', async () => {
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

    const dashboards = await agent.get(`/dashboards`).expect(200);

    // Make sure all alerts are attached to the dashboard charts
    const allCharts = dashboard.charts.map(chart => chart.id).sort();
    const chartsWithAlerts = dashboards.body.data[0].alerts
      .map(alert => alert.chartId)
      .sort();
    expect(allCharts).toEqual(chartsWithAlerts);

    // Delete the first chart
    await agent
      .put(`/dashboards/${dashboard._id}`)
      .send({
        ...dashboard,
        charts: dashboard.charts.slice(1),
      })
      .expect(200);

    const dashboardPostDelete = (await agent.get(`/dashboards`).expect(200))
      .body.data[0];

    // Make sure all alerts are attached to the dashboard charts
    const allChartsPostDelete = dashboardPostDelete.charts
      .map(chart => chart.id)
      .sort();
    const chartsWithAlertsPostDelete = dashboardPostDelete.alerts
      .map(alert => alert.chartId)
      .sort();
    expect(allChartsPostDelete).toEqual(chartsWithAlertsPostDelete);
  });
});
