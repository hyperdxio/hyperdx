import ms from 'ms';

import * as clickhouse from '@/clickhouse';
import { buildMetricSeries, getLoggedInAgent, getServer } from '@/fixtures';

describe.skip('metrics router', () => {
  const now = Date.now();
  let agent;
  let teamId;

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

  beforeEach(async () => {
    const { agent: _agent, team } = await getLoggedInAgent(server);
    agent = _agent;
    teamId = team.id;
    await clickhouse.bulkInsertTeamMetricStream(
      buildMetricSeries({
        name: 'test.cpu',
        tags: { host: 'host1', foo: 'bar' },
        data_type: clickhouse.MetricsDataType.Gauge,
        is_monotonic: false,
        is_delta: false,
        unit: 'Percent',
        points: [{ value: 1, timestamp: now - ms('1d') }],
        team_id: team.id,
      }),
    );
    await clickhouse.bulkInsertTeamMetricStream(
      buildMetricSeries({
        name: 'test.cpu',
        tags: { host: 'host2', foo2: 'bar2' },
        data_type: clickhouse.MetricsDataType.Gauge,
        is_monotonic: false,
        is_delta: false,
        unit: 'Percent',
        points: [{ value: 1, timestamp: now - ms('1d') }],
        team_id: team.id,
      }),
    );
    await clickhouse.bulkInsertTeamMetricStream(
      buildMetricSeries({
        name: 'test.cpu2',
        tags: { host: 'host2', foo2: 'bar2' },
        data_type: clickhouse.MetricsDataType.Gauge,
        is_monotonic: false,
        is_delta: false,
        unit: 'Percent',
        points: [{ value: 1, timestamp: now - ms('1d') }],
        team_id: team.id,
      }),
    );
  });

  it('GET /metrics/names', async () => {
    const names = await agent.get('/metrics/names').expect(200);
    expect(names.body.data).toMatchInlineSnapshot(`
Array [
  Object {
    "data_type": "Gauge",
    "is_delta": false,
    "is_monotonic": false,
    "name": "test.cpu - Gauge",
    "unit": "Percent",
  },
  Object {
    "data_type": "Gauge",
    "is_delta": false,
    "is_monotonic": false,
    "name": "test.cpu2 - Gauge",
    "unit": "Percent",
  },
]
`);
  });

  it('GET /metrics/tags - single metric', async () => {
    const tags = await agent
      .post('/metrics/tags')
      .send({
        metrics: [
          {
            name: 'test.cpu',
            dataType: clickhouse.MetricsDataType.Gauge,
          },
        ],
      })
      .expect(200);
    expect(tags.body.data).toMatchInlineSnapshot(`
Array [
  Object {
    "data_type": "Gauge",
    "name": "test.cpu - Gauge",
    "tags": Array [
      Object {
        "foo2": "bar2",
        "host": "host2",
      },
      Object {
        "foo": "bar",
        "host": "host1",
      },
    ],
  },
]
`);
  });

  it('GET /metrics/tags - multi metrics', async () => {
    const tags = await agent
      .post('/metrics/tags')
      .send({
        metrics: [
          {
            name: 'test.cpu',
            dataType: clickhouse.MetricsDataType.Gauge,
          },
          {
            name: 'test.cpu2',
            dataType: clickhouse.MetricsDataType.Gauge,
          },
        ],
      })
      .expect(200);
    expect(tags.body.data).toMatchInlineSnapshot(`
Array [
  Object {
    "data_type": "Gauge",
    "name": "test.cpu - Gauge",
    "tags": Array [
      Object {
        "foo2": "bar2",
        "host": "host2",
      },
      Object {
        "foo": "bar",
        "host": "host1",
      },
    ],
  },
  Object {
    "data_type": "Gauge",
    "name": "test.cpu2 - Gauge",
    "tags": Array [
      Object {
        "foo2": "bar2",
        "host": "host2",
      },
    ],
  },
]
`);
  });
});
