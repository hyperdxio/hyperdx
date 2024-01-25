import * as clickhouse from '@/clickhouse';
import {
  buildMetricSeries,
  clearClickhouseTables,
  clearDBCollections,
  clearRedis,
  closeDB,
  getLoggedInAgent,
  getServer,
} from '@/fixtures';

describe('metrics router', () => {
  const server = getServer();

  beforeAll(async () => {
    await server.start();
  });

  afterEach(async () => {
    await clearDBCollections();
    await clearClickhouseTables();
    await clearRedis();
  });

  afterAll(async () => {
    await server.closeHttpServer();
    await closeDB();
  });

  it('GET /metrics/tags', async () => {
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
      }),
    );

    const { agent } = await getLoggedInAgent(server);
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
