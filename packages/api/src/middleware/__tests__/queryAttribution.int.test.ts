import * as config from '@/config';
import {
  DEFAULT_DATABASE,
  dropTimeSeriesTable,
  getLoggedInAgent,
  getServer,
  getTestFixtureClickHouseClient,
  seedTimeSeriesTagsTable,
} from '@/fixtures';
import Connection from '@/models/connection';

// Covers the wiring the unit tests can't: auth middleware opens the
// AsyncLocalStorage scope, and a query issued deep inside the route handler
// still reads it. If that scope is lost, queries fall back to hdx-unknown-*.
describe('request query attribution', () => {
  const server = getServer();
  // Unique per run so query_log rows from earlier runs can't match.
  const TABLE = `query_attribution_${Date.now()}`;

  beforeAll(async () => {
    await server.start();
    await seedTimeSeriesTagsTable({
      table: TABLE,
      series: [
        {
          metricName: 'attribution_metric',
          tags: { job: 'api' },
          startSec: 1700000000,
          endSec: 1700003600,
        },
      ],
    });
  });

  afterEach(async () => {
    await server.clearDBs();
  });

  afterAll(async () => {
    await dropTimeSeriesTable({ table: TABLE });
    await server.stop();
  });

  // query_log is written asynchronously, so flush and poll.
  async function findRouteQueries() {
    const client = await getTestFixtureClickHouseClient();
    for (let attempt = 0; attempt < 10; attempt++) {
      await client.command({ query: 'SYSTEM FLUSH LOGS' });
      const result = await client.query({
        query: `
          SELECT query_id, log_comment
          FROM system.query_log
          WHERE type = 'QueryFinish'
            AND query_kind = 'Select'
            AND has(tables, {table:String})`,
        query_params: { table: `${DEFAULT_DATABASE}.${TABLE}` },
        format: 'JSON',
      });
      const { data }: { data: { query_id: string; log_comment: string }[] } =
        await result.json();
      if (data.length > 0) return data;
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    return [];
  }

  it('tags queries from an authenticated route with the api surface', async () => {
    const { agent, team } = await getLoggedInAgent(server);
    const conn = await Connection.create({
      team: team._id,
      name: 'CH',
      host: config.CLICKHOUSE_HOST,
      username: config.CLICKHOUSE_USER,
      password: config.CLICKHOUSE_PASSWORD,
    });

    await agent
      .get('/v1/prometheus/labels')
      .query({
        connectionId: conn._id.toString(),
        database: DEFAULT_DATABASE,
        table: TABLE,
      })
      .expect(200);

    const logged = await findRouteQueries();
    expect(logged.length).toBeGreaterThan(0);
    for (const row of logged) {
      expect(row.query_id).toMatch(/^hdx-api-/);
      expect(JSON.parse(row.log_comment)).toMatchObject({
        surface: 'api',
        label: '/v1/prometheus',
      });
    }
  });
});
