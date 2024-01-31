import ms from 'ms';

import * as clickhouse from '@/clickhouse';
import { buildMetricSeries, getLoggedInAgent, getServer } from '@/fixtures';

describe('metrics router', () => {
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

  it('GET /metrics/names + /metrics/tags', async () => {
    const { agent, team } = await getLoggedInAgent(server);

    const now = Date.now();
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

    const resp = await clickhouse.client.query({
      query: 'select _timestamp_sort_key from metric_stream',
      format: 'JSONEachRow',
    });

    const names = await agent.get('/metrics/names').expect(200);
    expect(names.body.data).toEqual([
      {
        is_delta: false,
        is_monotonic: false,
        unit: 'Percent',
        data_type: 'Gauge',
        name: 'test.cpu - Gauge',
      },
    ]);
    const tags = await agent
      .get('/metrics/tags?name=test.cpu&dataType=Gauge')
      .expect(200);
    expect(tags.body.data).toEqual([
      { tag: { host: 'host2', foo2: 'bar2' } },
      { tag: { host: 'host1', foo: 'bar' } },
    ]);
  });
});
