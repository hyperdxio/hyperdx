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

describe('alerts router', () => {
  const server = getServer();

  it('index has alerts attached to dashboards', async () => {
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
