import _ from 'lodash';

import {
  getLoggedInAgent,
  getServer,
  makeChart,
  makeExternalAlert,
} from '@/fixtures';

const MOCK_DASHBOARD = {
  name: 'Test Dashboard',
  charts: [
    makeChart({ id: 'aaaaaaa' }),
    makeChart({ id: 'bbbbbbb' }),
    makeChart({ id: 'ccccccc' }),
    makeChart({ id: 'ddddddd' }),
    makeChart({ id: 'eeeeeee' }),
  ],
  query: 'test query',
};

describe('/api/v1/alerts', () => {
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

  it('CRUD Dashboard Alerts', async () => {
    const { agent, user } = await getLoggedInAgent(server);

    await agent.post('/dashboards').send(MOCK_DASHBOARD).expect(200);
    const initialDashboards = await agent.get('/dashboards').expect(200);

    // Create alerts for all charts
    const dashboard = initialDashboards.body.data[0];
    await Promise.all(
      dashboard.charts.map(chart =>
        agent
          .post('/api/v1/alerts')
          .set('Authorization', `Bearer ${user?.accessKey}`)
          .send(
            makeExternalAlert({
              dashboardId: dashboard._id,
              chartId: chart.id,
            }),
          )
          .expect(200),
      ),
    );

    const alerts = await agent
      .get(`/api/v1/alerts`)
      .set('Authorization', `Bearer ${user?.accessKey}`)
      .expect(200);
    // sort alerts.body.data by chartId
    const sortedAlerts = alerts.body.data
      .sort((a, b) => {
        if (a.chartId < b.chartId) {
          return -1;
        }
        if (a.chartId > b.chartId) {
          return 1;
        }
        return 0;
      })
      .map(alert => {
        return {
          ..._.omit(alert, ['id', 'dashboardId']),
        };
      });

    for (let i = 0; i < 5; i++) {
      expect(alerts.body.data[i].dashboardId.length).toBeGreaterThan(0);
      expect(alerts.body.data[i].id.length).toBeGreaterThan(0);
    }

    expect(sortedAlerts).toMatchInlineSnapshot(`
Array [
  Object {
    "channel": Object {
      "type": "slack_webhook",
      "webhookId": "65ad876b6b08426ab4ba7830",
    },
    "chartId": "aaaaaaa",
    "interval": "15m",
    "source": "chart",
    "threshold": 8,
    "threshold_type": "above",
  },
  Object {
    "channel": Object {
      "type": "slack_webhook",
      "webhookId": "65ad876b6b08426ab4ba7830",
    },
    "chartId": "bbbbbbb",
    "interval": "15m",
    "source": "chart",
    "threshold": 8,
    "threshold_type": "above",
  },
  Object {
    "channel": Object {
      "type": "slack_webhook",
      "webhookId": "65ad876b6b08426ab4ba7830",
    },
    "chartId": "ccccccc",
    "interval": "15m",
    "source": "chart",
    "threshold": 8,
    "threshold_type": "above",
  },
  Object {
    "channel": Object {
      "type": "slack_webhook",
      "webhookId": "65ad876b6b08426ab4ba7830",
    },
    "chartId": "ddddddd",
    "interval": "15m",
    "source": "chart",
    "threshold": 8,
    "threshold_type": "above",
  },
  Object {
    "channel": Object {
      "type": "slack_webhook",
      "webhookId": "65ad876b6b08426ab4ba7830",
    },
    "chartId": "eeeeeee",
    "interval": "15m",
    "source": "chart",
    "threshold": 8,
    "threshold_type": "above",
  },
]
`);

    const alertById = await agent
      .get(`/api/v1/alerts/${alerts.body.data[0].id}`)
      .set('Authorization', `Bearer ${user?.accessKey}`)
      .expect(200);

    expect(alertById.body.data).toEqual(alerts.body.data[0]);

    for (let i = 0; i < 4; i++) {
      await agent
        .delete(`/api/v1/alerts/${alerts.body.data[i].id}`)
        .set('Authorization', `Bearer ${user?.accessKey}`)
        .expect(200);
    }

    const remainingAlert = alerts.body.data[4];
    const updateAlert = await agent
      .put(`/api/v1/alerts/${remainingAlert.id}`)
      .send(
        makeExternalAlert({
          dashboardId: remainingAlert.dashboardId,
          chartId: remainingAlert.chartId,
          threshold: 1000,
          interval: '1h',
        }),
      )
      .set('Authorization', `Bearer ${user?.accessKey}`)
      .expect(200);

    expect(_.omit(updateAlert.body.data, ['id', 'chartId', 'dashboardId']))
      .toMatchInlineSnapshot(`
Object {
  "channel": Object {
    "type": "slack_webhook",
    "webhookId": "65ad876b6b08426ab4ba7830",
  },
  "interval": "1h",
  "source": "chart",
  "threshold": 1000,
  "threshold_type": "above",
}
`);

    const singleAlert = await agent
      .get(`/api/v1/alerts`)
      .set('Authorization', `Bearer ${user?.accessKey}`)
      .expect(200);

    expect(singleAlert.body.data.length).toBe(1);
    expect(singleAlert.body.data[0].id).toEqual(remainingAlert.id);
    expect(_.omit(singleAlert.body.data[0], ['id', 'chartId', 'dashboardId']))
      .toMatchInlineSnapshot(`
Object {
  "channel": Object {
    "type": "slack_webhook",
    "webhookId": "65ad876b6b08426ab4ba7830",
  },
  "interval": "1h",
  "source": "chart",
  "threshold": 1000,
  "threshold_type": "above",
}
`);
  });
});
