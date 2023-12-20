import {
  clearDBCollections,
  closeDB,
  getLoggedInAgent,
  getServer,
} from '@/fixtures';

const randomId = () => Math.random().toString(36).substring(7);

const makeChart = () => ({
  id: randomId(),
  name: 'Test Chart',
  x: 1,
  y: 1,
  w: 1,
  h: 1,
  series: [
    {
      type: 'time',
      table: 'metrics',
    },
  ],
});

const makeAlert = ({
  dashboardId,
  chartId,
}: {
  dashboardId: string;
  chartId: string;
}) => ({
  channel: {
    type: 'webhook',
    webhookId: 'test-webhook-id',
  },
  interval: '15m',
  threshold: 8,
  type: 'presence',
  source: 'CHART',
  dashboardId,
  chartId,
});

const MOCK_DASHBOARD = {
  name: 'Test Dashboard',
  charts: [makeChart(), makeChart(), makeChart(), makeChart(), makeChart()],
  query: 'test query',
};

describe('dashboard router', () => {
  const server = getServer();

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
});
