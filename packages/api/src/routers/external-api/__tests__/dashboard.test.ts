import _ from 'lodash';

import {
  clearDBCollections,
  closeDB,
  getLoggedInAgent,
  getServer,
  makeExternalAlert,
  makeExternalChart,
} from '@/fixtures';

const MOCK_DASHBOARD = {
  name: 'Test Dashboard',
  charts: [
    makeExternalChart(),
    makeExternalChart(),
    makeExternalChart(),
    makeExternalChart(),
  ],
  query: 'test query',
};

function removeDashboardIds(dashboard: any) {
  const dashboardWithoutIds = _.omit(dashboard, ['id']);
  dashboardWithoutIds.charts = dashboardWithoutIds.charts.map(chart => {
    return _.omit(chart, ['id']);
  });

  return dashboardWithoutIds;
}

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

  it('CRUD /dashboards', async () => {
    const { agent, user } = await getLoggedInAgent(server);

    await agent
      .post('/api/v1/dashboards')
      .set('Authorization', `Bearer ${user?.accessKey}`)
      .send(MOCK_DASHBOARD)
      .expect(200);

    const initialDashboards = await agent
      .get('/api/v1/dashboards')
      .set('Authorization', `Bearer ${user?.accessKey}`)
      .expect(200);

    const singleDashboard = await agent
      .get(`/api/v1/dashboards/${initialDashboards.body.data[0].id}`)
      .set('Authorization', `Bearer ${user?.accessKey}`)
      .send(MOCK_DASHBOARD)
      .expect(200);

    expect(removeDashboardIds(singleDashboard.body.data))
      .toMatchInlineSnapshot(`
Object {
  "charts": Array [
    Object {
      "asRatio": false,
      "h": 1,
      "name": "Test Chart",
      "series": Array [
        Object {
          "aggFn": "count",
          "data_source": "events",
          "groupBy": Array [],
          "type": "time",
          "where": "",
        },
      ],
      "w": 1,
      "x": 1,
      "y": 1,
    },
    Object {
      "asRatio": false,
      "h": 1,
      "name": "Test Chart",
      "series": Array [
        Object {
          "aggFn": "count",
          "data_source": "events",
          "groupBy": Array [],
          "type": "time",
          "where": "",
        },
      ],
      "w": 1,
      "x": 1,
      "y": 1,
    },
    Object {
      "asRatio": false,
      "h": 1,
      "name": "Test Chart",
      "series": Array [
        Object {
          "aggFn": "count",
          "data_source": "events",
          "groupBy": Array [],
          "type": "time",
          "where": "",
        },
      ],
      "w": 1,
      "x": 1,
      "y": 1,
    },
    Object {
      "asRatio": false,
      "h": 1,
      "name": "Test Chart",
      "series": Array [
        Object {
          "aggFn": "count",
          "data_source": "events",
          "groupBy": Array [],
          "type": "time",
          "where": "",
        },
      ],
      "w": 1,
      "x": 1,
      "y": 1,
    },
  ],
  "name": "Test Dashboard",
  "query": "test query",
}
`);

    const dashboardWithoutIds = removeDashboardIds(
      initialDashboards.body.data[0],
    );

    expect(dashboardWithoutIds).toMatchInlineSnapshot(`
Object {
  "charts": Array [
    Object {
      "asRatio": false,
      "h": 1,
      "name": "Test Chart",
      "series": Array [
        Object {
          "aggFn": "count",
          "data_source": "events",
          "groupBy": Array [],
          "type": "time",
          "where": "",
        },
      ],
      "w": 1,
      "x": 1,
      "y": 1,
    },
    Object {
      "asRatio": false,
      "h": 1,
      "name": "Test Chart",
      "series": Array [
        Object {
          "aggFn": "count",
          "data_source": "events",
          "groupBy": Array [],
          "type": "time",
          "where": "",
        },
      ],
      "w": 1,
      "x": 1,
      "y": 1,
    },
    Object {
      "asRatio": false,
      "h": 1,
      "name": "Test Chart",
      "series": Array [
        Object {
          "aggFn": "count",
          "data_source": "events",
          "groupBy": Array [],
          "type": "time",
          "where": "",
        },
      ],
      "w": 1,
      "x": 1,
      "y": 1,
    },
    Object {
      "asRatio": false,
      "h": 1,
      "name": "Test Chart",
      "series": Array [
        Object {
          "aggFn": "count",
          "data_source": "events",
          "groupBy": Array [],
          "type": "time",
          "where": "",
        },
      ],
      "w": 1,
      "x": 1,
      "y": 1,
    },
  ],
  "name": "Test Dashboard",
  "query": "test query",
}
`);

    // Create alerts for all charts
    const dashboard = initialDashboards.body.data[0];
    await Promise.all(
      dashboard.charts.map(chart =>
        agent
          .post('/api/v1/alerts')
          .set('Authorization', `Bearer ${user?.accessKey}`)
          .send(
            makeExternalAlert({
              dashboardId: dashboard.id,
              chartId: chart.id,
            }),
          )
          .expect(200),
      ),
    );

    // Delete the first chart
    const dashboardPutWithoutFirstChart = await agent
      .put(`/api/v1/dashboards/${dashboard.id}`)
      .set('Authorization', `Bearer ${user?.accessKey}`)
      .send({
        ...dashboard,
        charts: dashboard.charts.slice(1),
      })
      .expect(200);

    expect(removeDashboardIds(dashboardPutWithoutFirstChart.body.data))
      .toMatchInlineSnapshot(`
Object {
  "charts": Array [
    Object {
      "asRatio": false,
      "h": 1,
      "name": "Test Chart",
      "series": Array [
        Object {
          "aggFn": "count",
          "data_source": "events",
          "groupBy": Array [],
          "type": "time",
          "where": "",
        },
      ],
      "w": 1,
      "x": 1,
      "y": 1,
    },
    Object {
      "asRatio": false,
      "h": 1,
      "name": "Test Chart",
      "series": Array [
        Object {
          "aggFn": "count",
          "data_source": "events",
          "groupBy": Array [],
          "type": "time",
          "where": "",
        },
      ],
      "w": 1,
      "x": 1,
      "y": 1,
    },
    Object {
      "asRatio": false,
      "h": 1,
      "name": "Test Chart",
      "series": Array [
        Object {
          "aggFn": "count",
          "data_source": "events",
          "groupBy": Array [],
          "type": "time",
          "where": "",
        },
      ],
      "w": 1,
      "x": 1,
      "y": 1,
    },
  ],
  "name": "Test Dashboard",
  "query": "test query",
  "tags": Array [],
}
`);

    await agent
      .delete(`/api/v1/dashboards/${dashboard.id}`)
      .set('Authorization', `Bearer ${user?.accessKey}`)
      .expect(200);

    expect(
      (
        await agent
          .get('/api/v1/dashboards')
          .set('Authorization', `Bearer ${user?.accessKey}`)
          .expect(200)
      ).body.data.length,
    ).toBe(0);
  });

  it('can create all the chart types', async () => {
    const { agent, user } = await getLoggedInAgent(server);

    await agent
      .post('/api/v1/dashboards')
      .set('Authorization', `Bearer ${user?.accessKey}`)
      .send({
        id: '65adc1f516a4b2d24709c56d',
        name: 'i dont break there',
        charts: [
          {
            id: '1mbgno',
            name: 'two time series',
            x: 0,
            y: 0,
            w: 7,
            h: 3,
            asRatio: false,
            series: [
              {
                type: 'time',
                data_source: 'events',
                aggFn: 'count',
                where: '',
                groupBy: [],
              },
              {
                type: 'time',
                data_source: 'events',
                aggFn: 'count',
                where: 'level:err',
                groupBy: [],
              },
            ],
          },
          {
            id: 'va8j6',
            name: 'ratio time series',
            x: 4,
            y: 3,
            w: 4,
            h: 2,
            asRatio: true,
            series: [
              {
                type: 'time',
                data_source: 'events',
                aggFn: 'count',
                where: '',
                groupBy: [],
              },
              {
                type: 'time',
                data_source: 'events',
                aggFn: 'count',
                where: 'level:err',
                groupBy: [],
              },
            ],
          },
          {
            id: 'q91iu',
            name: 'table chart',
            x: 7,
            y: 0,
            w: 5,
            h: 3,
            asRatio: false,
            series: [
              {
                type: 'table',
                data_source: 'events',
                aggFn: 'count',
                where: '',
                groupBy: [],
                sortOrder: 'desc',
              },
            ],
          },
          {
            id: '18efq2',
            name: 'histogram chart',
            x: 0,
            y: 5,
            w: 4,
            h: 2,
            asRatio: false,
            series: [
              {
                type: 'histogram',
                data_source: 'events',
                field: 'duration',
                where: '',
              },
            ],
          },
          {
            id: 't10am',
            name: 'markdown chart',
            x: 8,
            y: 3,
            w: 4,
            h: 2,
            asRatio: false,
            series: [
              {
                type: 'markdown',
                data_source: 'events',
                content: 'makedown',
              },
            ],
          },
          {
            id: '1ip8he',
            name: 'number chart',
            x: 4,
            y: 5,
            w: 4,
            h: 2,
            asRatio: false,
            series: [
              {
                type: 'number',
                data_source: 'events',
                aggFn: 'count',
                where: 'level:err OR level:warn',
              },
            ],
          },
          {
            id: 'ipr35',
            name: 'search chart',
            x: 0,
            y: 3,
            w: 4,
            h: 2,
            asRatio: false,
            series: [
              {
                type: 'search',
                data_source: 'events',
                where: 'level:warn',
              },
            ],
          },
        ],
        query: '',
      })
      .expect(200);

    expect(
      removeDashboardIds(
        (
          await agent
            .get('/api/v1/dashboards')
            .set('Authorization', `Bearer ${user?.accessKey}`)
            .expect(200)
        ).body.data[0],
      ),
    ).toMatchInlineSnapshot(`
Object {
  "charts": Array [
    Object {
      "asRatio": false,
      "h": 3,
      "name": "two time series",
      "series": Array [
        Object {
          "aggFn": "count",
          "data_source": "events",
          "groupBy": Array [],
          "type": "time",
          "where": "",
        },
        Object {
          "aggFn": "count",
          "data_source": "events",
          "groupBy": Array [],
          "type": "time",
          "where": "level:err",
        },
      ],
      "w": 7,
      "x": 0,
      "y": 0,
    },
    Object {
      "asRatio": true,
      "h": 2,
      "name": "ratio time series",
      "series": Array [
        Object {
          "aggFn": "count",
          "data_source": "events",
          "groupBy": Array [],
          "type": "time",
          "where": "",
        },
        Object {
          "aggFn": "count",
          "data_source": "events",
          "groupBy": Array [],
          "type": "time",
          "where": "level:err",
        },
      ],
      "w": 4,
      "x": 4,
      "y": 3,
    },
    Object {
      "asRatio": false,
      "h": 3,
      "name": "table chart",
      "series": Array [
        Object {
          "aggFn": "count",
          "data_source": "events",
          "groupBy": Array [],
          "sortOrder": "desc",
          "type": "table",
          "where": "",
        },
      ],
      "w": 5,
      "x": 7,
      "y": 0,
    },
    Object {
      "asRatio": false,
      "h": 2,
      "name": "histogram chart",
      "series": Array [
        Object {
          "data_source": "events",
          "field": "duration",
          "type": "histogram",
          "where": "",
        },
      ],
      "w": 4,
      "x": 0,
      "y": 5,
    },
    Object {
      "asRatio": false,
      "h": 2,
      "name": "markdown chart",
      "series": Array [
        Object {
          "content": "makedown",
          "data_source": "events",
          "type": "markdown",
        },
      ],
      "w": 4,
      "x": 8,
      "y": 3,
    },
    Object {
      "asRatio": false,
      "h": 2,
      "name": "number chart",
      "series": Array [
        Object {
          "aggFn": "count",
          "data_source": "events",
          "type": "number",
          "where": "level:err OR level:warn",
        },
      ],
      "w": 4,
      "x": 4,
      "y": 5,
    },
    Object {
      "asRatio": false,
      "h": 2,
      "name": "search chart",
      "series": Array [
        Object {
          "data_source": "events",
          "type": "search",
          "where": "level:warn",
        },
      ],
      "w": 4,
      "x": 0,
      "y": 3,
    },
  ],
  "name": "i dont break there",
  "query": "",
}
`);
  });
});
