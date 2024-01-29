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

  it('GET /metrics/tags', async () => {
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
        points: [{ value: 1, timestamp: now }],
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
        points: [{ value: 1, timestamp: now }],
        team_id: team.id,
      }),
    );

    const results = await agent.get('/metrics/tags').expect(200);
    expect(results.body.data).toEqual([
      {
        is_delta: false,
        is_monotonic: false,
        unit: 'Percent',
        data_type: 'Gauge',
        name: 'test.cpu - Gauge',
        tags: [
          {
            foo2: 'bar2',
            host: 'host2',
          },
          {
            foo: 'bar',
            host: 'host1',
          },
        ],
      },
    ]);
  });
});
